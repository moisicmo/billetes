import { type RouteConfig, index, route } from "@react-router/dev/routes";

export default [
  index("routes/home.tsx"),
  route("/api/ocr", "routes/api.ocr.ts"),
] satisfies RouteConfig;
