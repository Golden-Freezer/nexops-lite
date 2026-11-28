declare module 'dom-to-image-more' {
  interface Options {
    filter?: (node: Node) => boolean;
    bgcolor?: string;
    width?: number;
    height?: number;
    style?: Partial<CSSStyleDeclaration>;
    quality?: number;
    imagePlaceholder?: string;
    cacheBust?: boolean;
    scale?: number;
    corsImg?: { useCORS: boolean };
    /** 웹폰트 임베드 끄기 — 호출 측이 쓰인 글꼴만 <style>로 넣는다(capture.ts captureToBlob) */
    disableEmbedFonts?: boolean;
    /** 복제 루트가 완성된 뒤(직렬화 전) 호출 — 복제 단계는 원본의 <style>을 빼므로 글꼴 <style>은 여기서 넣는다 */
    onclone?: (clone: Node) => unknown;
  }

  export type { Options };

  function toSvg(node: Node, options?: Options): Promise<string>;
  function toPng(node: Node, options?: Options): Promise<string>;
  function toJpeg(node: Node, options?: Options): Promise<string>;
  function toBlob(node: Node, options?: Options): Promise<Blob>;
  function toCanvas(node: Node, options?: Options): Promise<HTMLCanvasElement>;
  function toPixelData(node: Node, options?: Options): Promise<Uint8ClampedArray>;

  export { toSvg, toPng, toJpeg, toBlob, toCanvas, toPixelData };
  // eslint-disable-next-line import/no-anonymous-default-export
  export default { toSvg, toPng, toJpeg, toBlob, toCanvas, toPixelData };
}
