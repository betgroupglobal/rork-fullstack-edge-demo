const { getDefaultConfig } = require("expo/metro-config");
const { withRorkMetro } = require("@rork-ai/toolkit-sdk/metro");

const config = getDefaultConfig(__dirname);

const rorkConfig = withRorkMetro(config);

// Redirect old RN inspector paths (sdk53) to their new location in RN 0.81+
const inspectorAliases = {
  "react-native/src/private/inspector/getInspectorDataForViewAtPoint":
    "react-native/src/private/devsupport/devmenu/elementinspector/getInspectorDataForViewAtPoint",
  "react-native/src/private/inspector/InspectorOverlay":
    "react-native/src/private/devsupport/devmenu/elementinspector/InspectorOverlay",
  "react-native/src/private/inspector/InspectorPanel":
    "react-native/src/private/devsupport/devmenu/elementinspector/InspectorPanel",
};

const upstreamResolve = rorkConfig.server?.enhanceMiddleware
  ? undefined
  : rorkConfig.resolver?.resolveRequest;

rorkConfig.resolver = {
  ...rorkConfig.resolver,
  resolveRequest: (context, moduleName, platform) => {
    if (inspectorAliases[moduleName]) {
      return { filePath: inspectorAliases[moduleName], type: "sourceFile" };
    }
    if (upstreamResolve) {
      return upstreamResolve(context, moduleName, platform);
    }
    return context.resolveRequest(context, moduleName, platform);
  },
};

// If withRorkMetro uses enhanceMiddleware instead of resolveRequest, wrap that
if (rorkConfig.server?.enhanceMiddleware) {
  const origEnhance = rorkConfig.server.enhanceMiddleware;
  rorkConfig.server.enhanceMiddleware = (middleware, server) => {
    return origEnhance(middleware, server);
  };
}

module.exports = rorkConfig;
