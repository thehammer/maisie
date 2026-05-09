import { createRoot } from "react-dom/client";
import { lazy, Suspense } from "react";

const path = window.location.pathname;
const isWidget = path.startsWith("/widget/");

// Only load dashboard styles for the main app — widgets use transparent backgrounds
if (!isWidget) {
  import("./styles.css");
} else {
  document.body.style.background = "transparent";
  document.body.style.margin = "0";
}

const App = lazy(() => import("./App").then((m) => ({ default: m.App })));
const AppNext = lazy(() =>
  import("./AppNext").then((m) => ({ default: m.AppNext })),
);
const MediaCalendarWidget = lazy(() =>
  import("./widgets/MediaCalendarWidget").then((m) => ({
    default: m.MediaCalendarWidget,
  })),
);
const CombinedCalendarWidget = lazy(() =>
  import("./widgets/CombinedCalendarWidget").then((m) => ({
    default: m.CombinedCalendarWidget,
  })),
);

const RecentMoviesWidget = lazy(() =>
  import("./widgets/RecentMoviesWidget").then((m) => ({
    default: m.RecentMoviesWidget,
  })),
);
const RecentShowsWidget = lazy(() =>
  import("./widgets/RecentShowsWidget").then((m) => ({
    default: m.RecentShowsWidget,
  })),
);
const RecentlyAddedWidget = lazy(() =>
  import("./widgets/RecentlyAddedWidget").then((m) => ({
    default: m.RecentlyAddedWidget,
  })),
);
const PackagesWidget = lazy(() =>
  import("./widgets/PackagesWidget").then((m) => ({
    default: m.PackagesWidget,
  })),
);

const widgets: Record<string, React.LazyExoticComponent<React.ComponentType>> = {
  "/widget/media-calendar": MediaCalendarWidget,
  "/widget/calendar": CombinedCalendarWidget,
  "/widget/recent-movies": RecentMoviesWidget,
  "/widget/recent-shows": RecentShowsWidget,
  "/widget/recently-added": RecentlyAddedWidget,
  "/widget/packages": PackagesWidget,
};

function Root() {
  const Widget = widgets[path];
  const isNext = path === "/next" || path.startsWith("/next/");
  return (
    <Suspense fallback={null}>
      {Widget ? <Widget /> : isNext ? <AppNext /> : <App />}
    </Suspense>
  );
}

createRoot(document.getElementById("root")!).render(<Root />);
