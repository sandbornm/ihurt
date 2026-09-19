import type { CapacitorConfig } from "@capacitor/cli";

const config: CapacitorConfig = {
  appId: "app.ihurt.notebook",
  appName: "iHurt",
  webDir: "dist/app",
  loggingBehavior: "none",
  server: { hostname: "localhost", iosScheme: "capacitor" },
  ios: {
    contentInset: "automatic",
    backgroundColor: "#101513",
    webContentsDebuggingEnabled: false,
  },
};

export default config;
