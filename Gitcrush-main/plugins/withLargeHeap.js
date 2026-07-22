const { withAndroidManifest } = require("@expo/config-plugins");

module.exports = function withLargeHeap(config) {
  return withAndroidManifest(config, (config) => {
    const application = config.modResults.manifest.application[0];
    application.$["android:largeHeap"] = "true";
    return config;
  });
};
