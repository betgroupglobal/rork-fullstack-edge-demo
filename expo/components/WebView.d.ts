import type { ComponentType } from "react";
import type { WebViewProps } from "react-native-webview";

/**
 * Type declaration for the platform-specific WebView component. At runtime Metro
 * resolves WebView.native.tsx (real WebView) or WebView.web.tsx (placeholder);
 * this declaration gives TypeScript a single module to resolve against.
 */
declare const WebView: ComponentType<WebViewProps>;
export default WebView;
