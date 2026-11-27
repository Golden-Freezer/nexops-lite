// frontend/src/data/frames/index.ts

export interface HeroFrame {
  id: string;
  name: string;
  clipPath: string;      // SVG clipPath의 path d 속성 (빈 문자열이면 프레임 없음)
  borderPath: string;    // 테두리 장식 path d 속성
  borderOpacity: number;
  viewBox: string;       // "0 0 300 400" (860px 기준으로 스케일링)
  bgColor: 'dark' | 'light';  // 프레임 내부 배경
  categories: string[];  // 적합한 카테고리 키워드
}

// 모든 path는 viewBox "0 0 300 400" 기준 — sectionConverter에서 860px로 스케일링
export const HERO_FRAMES: Record<string, HeroFrame> = {
  wave_mirror: {
    id: 'wave_mirror',
    name: '물결거울',
    clipPath: 'M150 30C190 30 220 45 235 70C255 105 245 140 230 170C215 200 225 235 240 260C255 290 245 330 220 350C195 370 170 375 150 375C130 375 105 370 80 350C55 330 45 290 60 260C75 235 85 200 70 170C55 140 45 105 65 70C80 45 110 30 150 30Z',
    borderPath: 'M150 30C190 30 220 45 235 70C255 105 245 140 230 170C215 200 225 235 240 260C255 290 245 330 220 350C195 370 170 375 150 375C130 375 105 370 80 350C55 330 45 290 60 260C75 235 85 200 70 170C55 140 45 105 65 70C80 45 110 30 150 30Z',
    borderOpacity: 0.5,
    viewBox: '0 0 300 400',
    bgColor: 'dark',
    categories: ['beauty', 'care', 'skincare', 'household'],
  },
  wave_wide: {
    id: 'wave_wide',
    name: '물결거울 와이드',
    clipPath: 'M40 70Q80 40 150 50Q220 40 260 70Q280 100 270 150Q285 200 270 250Q280 300 260 330Q220 360 150 350Q80 360 40 330Q20 300 30 250Q15 200 30 150Q20 100 40 70Z',
    borderPath: 'M40 70Q80 40 150 50Q220 40 260 70Q280 100 270 150Q285 200 270 250Q280 300 260 330Q220 360 150 350Q80 360 40 330Q20 300 30 250Q15 200 30 150Q20 100 40 70Z',
    borderOpacity: 0.5,
    viewBox: '0 0 300 400',
    bgColor: 'dark',
    categories: ['household', 'general', 'tool'],
  },
  blob: {
    id: 'blob',
    name: '비정형 블롭',
    clipPath: 'M150 35C200 25 260 80 255 150C250 210 270 250 240 310C210 360 160 380 120 360C70 340 30 290 40 230C50 180 35 130 60 80C85 35 120 40 150 35Z',
    borderPath: 'M150 35C200 25 260 80 255 150C250 210 270 250 240 310C210 360 160 380 120 360C70 340 30 290 40 230C50 180 35 130 60 80C85 35 120 40 150 35Z',
    borderOpacity: 0.4,
    viewBox: '0 0 300 400',
    bgColor: 'light',
    categories: ['food', 'organic', 'natural'],
  },
  petal: {
    id: 'petal',
    name: '꽃잎 실루엣',
    clipPath: 'M150 30C180 30 230 60 250 120C270 180 250 220 240 250C225 290 200 340 150 370C100 340 75 290 60 250C50 220 30 180 50 120C70 60 120 30 150 30Z',
    borderPath: 'M150 30C180 30 230 60 250 120C270 180 250 220 240 250C225 290 200 340 150 370C100 340 75 290 60 250C50 220 30 180 50 120C70 60 120 30 150 30Z',
    borderOpacity: 0.45,
    viewBox: '0 0 300 400',
    bgColor: 'dark',
    categories: ['beauty', 'gift', 'flower'],
  },
  cloud: {
    id: 'cloud',
    name: '클라우드',
    clipPath: 'M80 310C45 310 30 280 35 255C25 240 20 210 40 190C35 165 50 140 80 135C85 105 115 75 150 75C185 75 215 105 220 135C250 140 265 165 260 190C280 210 275 240 265 255C270 280 255 310 220 310Z',
    borderPath: 'M80 310C45 310 30 280 35 255C25 240 20 210 40 190C35 165 50 140 80 135C85 105 115 75 150 75C185 75 215 105 220 135C250 140 265 165 260 190C280 210 275 240 265 255C270 280 255 310 220 310Z',
    borderOpacity: 0.35,
    viewBox: '0 0 300 400',
    bgColor: 'light',
    categories: ['baby', 'pet', 'soft'],
  },
  scallop: {
    id: 'scallop',
    name: '스캘럽 오벌',
    clipPath: 'M150 40C170 40 188 48 198 55C215 45 235 50 248 65C260 82 258 100 250 115C268 125 278 145 275 168C272 188 260 202 248 208C258 225 260 248 250 268C240 285 225 295 210 298C212 318 205 338 190 350C175 362 158 365 145 362C132 375 112 382 92 375C75 368 62 352 58 338C42 342 25 332 18 315C10 298 15 278 25 265C12 252 5 232 10 212C15 195 28 182 42 175C35 158 38 138 48 122C60 108 78 100 92 100C90 82 98 62 112 50C125 40 140 38 150 40Z',
    borderPath: 'M150 40C170 40 188 48 198 55C215 45 235 50 248 65C260 82 258 100 250 115C268 125 278 145 275 168C272 188 260 202 248 208C258 225 260 248 250 268C240 285 225 295 210 298C212 318 205 338 190 350C175 362 158 365 145 362C132 375 112 382 92 375C75 368 62 352 58 338C42 342 25 332 18 315C10 298 15 278 25 265C12 252 5 232 10 212C15 195 28 182 42 175C35 158 38 138 48 122C60 108 78 100 92 100C90 82 98 62 112 50C125 40 140 38 150 40Z',
    borderOpacity: 0.4,
    viewBox: '0 0 300 400',
    bgColor: 'light',
    categories: ['beauty', 'jewelry', 'accessory'],
  },
  hexagon: {
    id: 'hexagon',
    name: '헥사곤',
    clipPath: 'M150 40L255 105L255 295L150 360L45 295L45 105Z',
    borderPath: 'M150 40L255 105L255 295L150 360L45 295L45 105Z',
    borderOpacity: 0.4,
    viewBox: '0 0 300 400',
    bgColor: 'dark',
    categories: ['digital', 'electronics', 'tech'],
  },
  oval: {
    id: 'oval',
    name: '오벌 민거울',
    clipPath: 'M150 45A105 150 0 0 1 150 345A105 150 0 0 1 150 45Z',
    borderPath: 'M150 45A105 150 0 0 1 150 345A105 150 0 0 1 150 45Z',
    borderOpacity: 0.4,
    viewBox: '0 0 300 400',
    bgColor: 'light',
    categories: ['beauty', 'skincare', 'classic'],
  },
  fan_arch: {
    id: 'fan_arch',
    name: '팬 아치',
    clipPath: 'M30 370L30 150C30 70 80 30 150 30C220 30 270 70 270 150L270 370Z',
    borderPath: 'M30 370L30 150C30 70 80 30 150 30C220 30 270 70 270 150L270 370',
    borderOpacity: 0.45,
    viewBox: '0 0 300 400',
    bgColor: 'dark',
    categories: ['interior', 'furniture', 'premium'],
  },
  keyhole: {
    id: 'keyhole',
    name: '키홀',
    clipPath: 'M150 35C200 35 240 75 240 125C240 165 218 198 185 215L200 370L100 370L115 215C82 198 60 165 60 125C60 75 100 35 150 35Z',
    borderPath: 'M150 35C200 35 240 75 240 125C240 165 218 198 185 215L200 370L100 370L115 215C82 198 60 165 60 125C60 75 100 35 150 35Z',
    borderOpacity: 0.4,
    viewBox: '0 0 300 400',
    bgColor: 'light',
    categories: ['gift', 'special', 'luxury'],
  },
  squircle: {
    id: 'squircle',
    name: '소프트 스퀘어클',
    clipPath: 'M35 45Q35 45 35 105L35 295Q35 355 95 355L205 355Q265 355 265 295L265 105Q265 45 205 45L95 45Q35 45 35 105Z',
    borderPath: 'M35 45Q35 45 35 105L35 295Q35 355 95 355L205 355Q265 355 265 295L265 105Q265 45 205 45L95 45Q35 45 35 105Z',
    borderOpacity: 0.4,
    viewBox: '0 0 300 400',
    bgColor: 'dark',
    categories: ['digital', 'app', 'minimal'],
  },
  leaf: {
    id: 'leaf',
    name: '리프',
    clipPath: 'M150 35C250 35 275 120 270 200C265 280 230 370 150 370C70 370 35 280 30 200C25 120 50 35 150 35Z',
    borderPath: 'M150 35C250 35 275 120 270 200C265 280 230 370 150 370C70 370 35 280 30 200C25 120 50 35 150 35Z',
    borderOpacity: 0.4,
    viewBox: '0 0 300 400',
    bgColor: 'light',
    categories: ['food', 'organic', 'eco'],
  },
  studio: {
    id: 'studio',
    name: '스튜디오 촬영컷',
    clipPath: '',
    borderPath: '',
    borderOpacity: 0,
    viewBox: '0 0 300 400',
    bgColor: 'dark',
    categories: ['fashion', 'food', 'digital', 'visual'],
  },
};

// 프레임 ID로 조회 (없으면 wave_wide 기본값)
export function getHeroFrame(frameId: string): HeroFrame {
  return HERO_FRAMES[frameId] || HERO_FRAMES['wave_wide'];
}
