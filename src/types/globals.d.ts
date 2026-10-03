// Replaced by esbuild at build time (tools/build.mjs).
declare const __APP_VERSION__: string;
declare const __DEV__: boolean;

// Stylesheets are bundled by esbuild.
declare module "*.css";

// Safari's own video extras, which TypeScript's DOM types leave out.
interface HTMLVideoElement {
  webkitEnterFullscreen?: () => void;
  webkitShowPlaybackTargetPicker?: () => void;
  webkitSupportsPresentationMode?: (mode: string) => boolean;
  webkitSetPresentationMode?: (mode: string) => void;
}
