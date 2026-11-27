// exportUtils/index.ts — D2 분할(2026-07-04): 공개 표면 재수출.
// 소비처 5파일(Canvas/ExportMenu/LeftPanel/ThinTopBar/TopToolbar)의
// '@/lib/registration/editor/utils/exportUtils' import 경로는 이 index가 그대로 받는다.
// 파일 경계 = §5 검증 경계: htmlBuilders/derivativeFilter(순수) vs capture/exporters(브라우저).

export type { ExportFormat } from './capture';
export {
  inlineExternalImages,
  withClonedCapture,
  withIsolatedElement,
  withNeutralizedAncestors,
  captureSliced,
  stitchBlobs,
  exportFullPagePngBlob,
} from './capture';
export {
  exportSectionPng,
  exportFullPagePng,
  exportZip,
  exportZipWithDerivatives,
  preloadAndInlineImages,
} from './exporters';
export { exportHtml, exportReviewHtml, exportRenderHtml } from './htmlBuilders';
export { filterSectionsByDerivative } from './derivativeFilter';
