// @ts-nocheck
import { ScrollViewStyleReset } from "expo-router/html";
import type { PropsWithChildren } from "react";

const legacyWebCacheCleanup = `
(function () {
  try {
    var sw = navigator.serviceWorker;
    var hadController = !!(sw && sw.controller);
    var reloadKey = "trackmyrmc-legacy-web-cache-reset-v1";
    var tasks = [];

    if (sw && sw.getRegistrations) {
      tasks.push(
        sw.getRegistrations().then(function (registrations) {
          return Promise.all(
            registrations.map(function (registration) {
              return registration.unregister();
            })
          );
        })
      );
    }

    if (window.caches && window.caches.keys) {
      tasks.push(
        window.caches.keys().then(function (keys) {
          return Promise.all(
            keys.map(function (key) {
              return window.caches.delete(key);
            })
          );
        })
      );
    }

    Promise.all(tasks)
      .then(function () {
        if (hadController && !window.sessionStorage.getItem(reloadKey)) {
          window.sessionStorage.setItem(reloadKey, "1");
          window.location.reload();
        }
      })
      .catch(function () {
        // Cache cleanup is best-effort and must never block the login shell.
      });
  } catch (_) {
    // Older browsers can continue without Cache Storage / Service Worker APIs.
  }
})();
`;

export default function Root({ children }: PropsWithChildren) {
  return (
    <html lang="en" style={{ height: "100%" }}>
      <head>
        <meta charSet="utf-8" />
        <meta httpEquiv="X-UA-Compatible" content="IE=edge" />
        <meta
          name="viewport"
          content="width=device-width, initial-scale=1, shrink-to-fit=no"
        />
        {/*
          Retire any service worker/cache left by older TrackMyRMC web builds.
          A legacy worker can otherwise serve a stale login shell on first load,
          with a manual refresh then revealing the current Expo deployment.
          This intentionally preserves cookies/localStorage/auth state.
        */}
        <script dangerouslySetInnerHTML={{ __html: legacyWebCacheCleanup }} />
        {/*
          Disable body scrolling on web to make ScrollView components work correctly.
          If you want to enable scrolling, remove `ScrollViewStyleReset` and
          set `overflow: auto` on the body style below.
        */}
        <ScrollViewStyleReset />
        <style
          dangerouslySetInnerHTML={{
            __html: `
              body > div:first-child { position: fixed !important; top: 0; left: 0; right: 0; bottom: 0; }
              [role="tablist"] [role="tab"] * { overflow: visible !important; }
              [role="heading"], [role="heading"] * { overflow: visible !important; }
            `,
          }}
        />
      </head>
      <body
        style={{
          margin: 0,
          height: "100%",
          overflow: "hidden",
          display: "flex",
          flexDirection: "column",
        }}
      >
        {children}
      </body>
    </html>
  );
}
