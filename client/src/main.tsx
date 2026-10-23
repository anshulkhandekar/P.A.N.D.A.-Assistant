import { createRoot } from "react-dom/client";
import { ProjectorApp } from "./pages/ProjectorApp";
import { WorkshopConsole } from "./workshop/WorkshopConsole";
import { WorkshopStage } from "./workshop/WorkshopStage";
import "./styles.css";
import "./workshop.css";

// The desktop shell loads the same routes as the browser development build.
const page =
  location.pathname === "/workshop" ? (
    <WorkshopConsole />
  ) : location.pathname === "/overlay" ? (
    <WorkshopStage />
  ) : (
    <ProjectorApp />
  );

createRoot(document.getElementById("root")!).render(page);
