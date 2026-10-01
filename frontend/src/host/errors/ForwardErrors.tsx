import { Component, type ReactNode } from "react";
import { failRegion, type ReportRegion } from "./failures";

// For UI that belongs to a region but isn't rendered inside it (a preview's outlines live
// in the screen-space overlay, not inside the scaled preview). A render error here fails
// the owning region, so it gets that region's error UI and single report (R6.5).
// Remount it (via `key`) when the owning region comes back.
export class ForwardErrors extends Component<
  { region: ReportRegion; screenId: string | null; children: ReactNode },
  { failed: boolean }
> {
  state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  componentDidCatch(error: unknown) {
    failRegion(this.props.region, this.props.screenId, error);
  }

  render() {
    return this.state.failed ? null : this.props.children;
  }
}
