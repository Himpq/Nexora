import { StatusBar } from "expo-status-bar";

import { AppBootstrap } from "./src/app/AppBootstrap";

export default function App() {
  return (
    <>
      <AppBootstrap />
      <StatusBar style="dark" />
    </>
  );
}
