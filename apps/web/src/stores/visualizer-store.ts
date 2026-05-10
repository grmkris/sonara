// Back-compat barrel — points at the slice-composed store under
// `./visualizer/`. New code should import from "@/stores/visualizer" directly;
// existing callers keep working through this re-export.
export * from "./visualizer";
