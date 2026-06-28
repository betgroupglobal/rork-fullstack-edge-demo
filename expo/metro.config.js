const { getDefaultConfig } = require("expo/metro-config");
const { withRorkMetro } = require("@rork-ai/toolkit-sdk/metro");

const config = getDefaultConfig(__dirname);
const rorkConfig = withRorkMetro(config);

// The SDK's sdk53 inspector imports from react-native/src/private/inspector/,
// but React Native 0.81.5 relocated those modules. Redirect to the real location.
const inspectorAliases = {
  "react-native/src/private/inspector/getInspectorDataForViewAtPoint":
    "react-native/src/private/devsupport/devmenu/elementinspector/getInspectorDataForViewAtPoint",
  "react-native/src/private/inspector/InspectorOverlay":
    "react-native/src/private/devsupport/devmenu/elementinspector/InspectorOverlay",
};

const originalResolveRequest = rorkConfig.resolver.resolveRequest;
rorkConfig.resolver.resolveRequest = (context, moduleName, platform) => {
  if (inspectorAliases[moduleName]) {
    return originalResolveRequest(context, inspectorAliases[moduleName], platform);
  }
  return originalResolveRequest(context, moduleName, platform);
};

module.exports = rorkConfig;
