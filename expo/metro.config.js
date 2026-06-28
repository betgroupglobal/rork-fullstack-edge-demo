const path = require("path");
const { getDefaultConfig } = require("expo/metro-config");
const { withRorkMetro } = require("@rork-ai/toolkit-sdk/metro");

const config = getDefaultConfig(__dirname);
const rorkConfig = withRorkMetro(config);

// Fix: redirect old RN inspector paths (used by sdk53) to their new locations in RN 0.81+
// The old paths under react-native/src/private/inspector/ were moved in RN 0.81.5
const inspectorRedirects = {
  "react-native/src/private/inspector/getInspectorDataForViewAtPoint":
    "react-native/src/private/devsupport/devmenu/elementinspector/getInspectorDataForViewAtPoint",
  "react-native/src/private/inspector/InspectorOverlay":
    "react-native/src/private/devsupport/devmenu/elementinspector/InspectorOverlay",
};

const rnRoot = path.dirname(require.resolve("react-native/package.json"));
const originalResolveRequest = rorkConfig.resolver?.resolveRequest;

rorkConfig.resolver = {
  ...rorkConfig.resolver,
  resolveRequest: (context, moduleName, platform) => {
    // Redirect old RN inspector paths to their current locations
    if (inspectorRedirects[moduleName]) {
      return {
        filePath: path.resolve(rnRoot, inspectorRedirects[moduleName]),
        type: "sourceFile",
      };
    }

    if (originalResolveRequest) {
      return originalResolveRequest(context, moduleName, platform);
    }

    return context.resolveRequest(context, moduleName, platform);
  },
};

module.exports = rorkConfig;
