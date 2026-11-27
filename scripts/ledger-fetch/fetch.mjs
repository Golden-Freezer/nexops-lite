// 오늘 장부 업데이트: 쿠팡 Wing·광고센터에서 파일 3개를 받아 내 NEXOPS 라이트 장부에 올린다.
// 사용: npm run ledger            (실제 쿠팡 화면, 전용 크롬 창에서 대표님이 처음 한 번 로그인)
//       npm run ledger -- --시험   (samples 폴더의 가짜 파일만 올림)
//       npm run ledger -- --올리기만 <폴더>  (이미 받은 파일만 올림)
// 설정: 장부받기/설정.txt (처음 실행하면 빈 칸이 있는 파일을 만들어 준다)
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..')
const BASE = path.join(ROOT, '장부받기')
const INBOX = path.join(BASE, '받은파일')
const DONE = path.join(BASE, '올린파일')
const SETTINGS = path.join(BASE, '설정.txt')
const SAMPLES = path.join(ROOT, 'samples')
const TEMPLATE = [
  '# NEXOPS 라이트 장부받기 설정. = 오른쪽만 고치세요.',
  '장부 주소=https://내프로젝트.vercel.app',
  '업로드 키=',
  'Wing 재고현황 주소=https://wing.coupang.com/tenants/rfm-inventory/management/list',
  '광고비 정산 주소=https://advertising.coupang.com/marketing-reporting/billboard/settlements/daily',
  '',
].join('\n')

let stage = '준비'
const say = (m) => console.log(m)

export function readSettings(file = SETTINGS) {
  const out = {}
  for (const line of fs.readFileSync(file, 'utf8').replace(/^﻿/, '').split(/\r?\n/)) {
    if (line.startsWith('#') || !line.includes('=')) continue
    const i = line.indexOf('=')
    out[line.slice(0, i).trim()] = line.slice(i + 1).trim()
  }
  return out
}

export function kindOf(name) {
  if (/^Statistics-\d{8}~\d{8}_\(\d+\)\.xlsx$/i.test(name)) return '판매 통계'
  if (/^inventory_health_sku_info_/i.test(name)) return '재고 현황'
  if (/-dailySettlement-/i.test(name)) return '광고비 정산'
  if (/_pa_total_campaign_|_pa_daily_campaign_/i.test(name)) return '광고 보고서'
  return null
}

async function navigate(page, url) {
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 })
  if (!page.url().startsWith(url)) {
    say('로그인이 필요합니다. 열린 크롬 창에서 쿠팡에 로그인해 주세요. (5분 기다립니다)')
    const deadline = Date.now() + 5 * 60 * 1000
    while (!page.url().startsWith(url)) {
      if (Date.now() > deadline) throw new Error('로그인 대기 시간이 5분을 지났습니다')
      await page.waitForTimeout(500)
    }
    await page.waitForLoadState('domcontentloaded')
  }
}

async function download(page, locator, check) {
  const [file] = await Promise.all([page.waitForEvent('download', { timeout: 60000 }), locator.click({ timeout: 60000 })])
  const name = file.suggestedFilename()
  if (!check(name)) throw new Error(`받은 파일 이름이 예상과 다릅니다: ${name}`)
  const dest = path.join(INBOX, name)
  if (fs.existsSync(dest)) fs.rmSync(dest)
  await file.saveAs(dest)
  return dest
}

async function fetchFromCoupang(settings) {
  let chromium
  try {
    ;({ chromium } = await import('playwright-core'))
  } catch {
    throw new Error('playwright-core가 없습니다. 장부 폴더에서 npm install 을 먼저 해 주세요')
  }
  const context = await chromium.launchPersistentContext(path.join(BASE, '크롬프로필'), {
    channel: 'chrome',
    headless: false,
    acceptDownloads: true,
  })
  const page = context.pages()[0] ?? (await context.newPage())
  page.setDefaultTimeout(60000)
  const files = []
  try {
    stage = 'Wing 로그인'
    await navigate(page, settings['Wing 재고현황 주소'])
    stage = '판매 통계'
    say('1/3 판매 통계(어제) 받는 중')
    await page.locator('.tab').filter({ hasText: '어제' }).first().click()
    await page.getByText('자세히보기', { exact: false }).first().click()
    const soldButton = page.getByText('전체 상품목록 엑셀 다운로드', { exact: false }).first()
    files.push(await download(page, soldButton, (n) => n.startsWith('Statistics-')))
    stage = '재고 현황'
    say('2/3 재고 현황 받는 중')
    await page.getByText('엑셀 다운로드', { exact: false }).filter({ hasNotText: '전체 상품목록' }).first().click()
    files.push(await download(page, page.getByText('엑셀 다운로드 요청', { exact: false }).first(), (n) => n.startsWith('inventory_health_sku_info_')))
    stage = '광고센터 로그인'
    await navigate(page, settings['광고비 정산 주소'])
    stage = '광고비 정산'
    say('3/3 광고비 정산(이번 달) 받는 중')
    await page.getByText('보고서 만들기', { exact: false }).first().click()
    files.push(await download(page, page.getByText('엑셀파일 다운로드', { exact: false }).first(), (n) => n.includes('-dailySettlement-')))
    if (new Date().getDate() === 1) {
      say('   오늘은 1일이라 지난달 광고비도 받습니다')
      await page.getByText('지난달', { exact: false }).first().click()
      await page.getByText('보고서 만들기', { exact: false }).first().click()
      files.push(await download(page, page.getByText('엑셀파일 다운로드', { exact: false }).first(), (n) => n.includes('-dailySettlement-')))
    }
  } catch (err) {
    await page.screenshot({ path: path.join(BASE, '받기오류.png') }).catch(() => {})
    throw err
  } finally {
    await context.close()
  }
  return files
}

export async function uploadFile(settings, file, fetchImpl = fetch) {
  const base = String(settings['장부 주소'] || '').replace(/\/+$/, '')
  const key = String(settings['업로드 키'] || '')
  const form = new FormData()
  form.append('file', new Blob([fs.readFileSync(file)]), path.basename(file))
  const res = await fetchImpl(`${base}/api/import/file`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${key}` },
    body: form,
  })
  const text = await res.text()
  let body
  try {
    body = JSON.parse(text)
  } catch {
    body = { error: text.slice(0, 200) }
  }
  if (!res.ok || body.ok === false) throw new Error(`${path.basename(file)}: ${body.error || res.status}`)
  return body
}

function checkSettings(settings) {
  const problems = []
  if (!/^https?:\/\//.test(settings['장부 주소'] || '') || (settings['장부 주소'] || '').includes('내프로젝트')) problems.push('장부 주소')
  if (!(settings['업로드 키'] || '').startsWith('nxo_pat_')) problems.push('업로드 키')
  if (problems.length) {
    throw new Error(`설정.txt의 ${problems.join(', ')}을(를) 채워 주세요. 업로드 키는 내 장부 ▶ 설정 ▶ 업로드 키에서 만듭니다 (${SETTINGS})`)
  }
}

export async function main(argv = process.argv.slice(2)) {
  fs.mkdirSync(INBOX, { recursive: true })
  fs.mkdirSync(DONE, { recursive: true })
  if (!fs.existsSync(SETTINGS)) {
    fs.writeFileSync(SETTINGS, TEMPLATE, 'utf8')
    throw new Error(`설정 파일을 만들었습니다. 장부 주소와 업로드 키를 채운 뒤 다시 실행하세요: ${SETTINGS}`)
  }
  const settings = readSettings()
  checkSettings(settings)
  let files
  if (argv.includes('--시험')) {
    stage = '시험 파일 준비'
    files = fs.readdirSync(SAMPLES).filter((n) => kindOf(n) && kindOf(n) !== '광고 보고서').map((n) => path.join(SAMPLES, n))
  } else if (argv.includes('--올리기만')) {
    const dir = argv[argv.indexOf('--올리기만') + 1] || INBOX
    files = fs.readdirSync(dir).filter((n) => kindOf(n)).map((n) => path.join(dir, n))
  } else {
    files = await fetchFromCoupang(settings)
  }
  if (!files.length) throw new Error('올릴 파일이 없습니다')
  // 재고(상품 불러오기) → 판매 → 광고비 → 광고 보고서 순서로 올린다
  const order = ['재고 현황', '판매 통계', '광고비 정산', '광고 보고서']
  files.sort((a, b) => order.indexOf(kindOf(path.basename(a))) - order.indexOf(kindOf(path.basename(b))))
  const results = []
  for (const file of files) {
    stage = `${kindOf(path.basename(file))} 올리기`
    say(`올리는 중: ${path.basename(file)}`)
    const r = await uploadFile(settings, file)
    results.push(r)
    say(`   완료 · 새로 ${r.inserted ?? 0} · 고침 ${r.updated ?? 0} · 건너뜀 ${r.skipped ?? 0}`)
    if (file.startsWith(INBOX)) fs.renameSync(file, path.join(DONE, path.basename(file)))
  }
  say(`끝: 파일 ${results.length}개를 장부에 올렸습니다. 장부 주소에서 대시보드를 새로고침해 보세요.`)
  return results
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((err) => {
    console.error(`${stage} 단계에서 멈췄습니다: ${err.message}`)
    process.exit(1)
  })
}
