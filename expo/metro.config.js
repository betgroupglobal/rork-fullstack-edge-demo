const { getDefaultConfig } = require("expo/metro-config");
const { withRorkMetro } = require("@rork-ai/toolkit-sdk/metro");

const config = withRorkMetro(getDefaultConfig(__dirname));

// In React Native 0.81.5 (Expo SDK 54) the element inspector internals moved
// from `react-native/src/private/inspector/*` to
// `react-native/src/private/devsupport/devmenu/elementinspector/*`.
// Some bundled SDK code still references the old paths, which breaks the
// Metro build. Redirect the stale module IDs to their new locations. This is
// package-manager independent (works whether deps install via bun or npm).
const INSPECTOR_PATH_REWRITES = {
  "react-native/src/private/inspector/getInspectorDataForViewAtPoint":
    "react-native/src/private/devsupport/devmenu/elementinspector/getInspectorDataForViewAtPoint",
  "react-native/src/private/inspector/InspectorOverlay":
    "react-native/src/private/devsupport/devmenu/elementinspector/InspectorOverlay",
  "react-native/src/private/inspector/InspectorPanel":
    "react-native/src/private/devsupport/devmenu/elementinspector/InspectorPanel",
};

const previousResolveRequest = config.resolver.resolveRequest;

config.resolver.resolveRequest = (context, moduleName, platform) => {
  const rewritten = INSPECTOR_PATH_REWRITES[moduleName];
  if (rewritten) {
    return context.resolveRequest(context, rewritten, platform);
  }
  if (previousResolveRequest) {
    return previousResolveRequest(context, moduleName, platform);
  }
  return context.resolveRequest(context, moduleName, platform);
};

module.exports = config;
