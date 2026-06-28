const { getDefaultConfig } = require("expo/metro-config");
const { withRorkMetro } = require("@rork-ai/toolkit-sdk/metro");

const config = getDefaultConfig(__dirname);

// Wrap the withRorkMetro result to add resolver aliases for the old
// react-native/src/private/inspector paths (used by SDK 53 inspector)
// that were moved in React Native 0.81.5 to devsupport/devmenu/elementinspector
const rorkConfig = withRorkMetro(config);

const originalResolveRequest = rorkConfig.resolver.resolveRequest;

const inspectorAliases = {
  "react-native/src/private/inspector/getInspectorDataForViewAtPoint":
    "react-native/src/private/devsupport/devmenu/elementinspector/getInspectorDataForViewAtPoint",
  "react-native/src/private/inspector/InspectorOverlay":
    "react-native/src/private/devsupport/devmenu/elementinspector/InspectorOverlay",
  "react-native/src/private/inspector/InspectorPanel":
    "react-native/src/private/devsupport/devmenu/elementinspector/InspectorPanel",
};

rorkConfig.resolver.resolveRequest = (context, moduleName, platform) => {
  if (inspectorAliases[moduleName]) {
    return originalResolveRequest(context, inspectorAliases[moduleName], platform);
  }
  return originalResolveRequest(context, moduleName, platform);
};

module.exports = rorkConfig;
