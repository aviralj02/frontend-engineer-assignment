import { Component, createContext, useContext, type ReactNode } from "react";
import { IconAlert, IconRetry } from "../icons";
import { isCancel, registerRegion, reportFailure, toError, type ReportRegion } from "./failures";

// One failure-isolation region (R6.1). Catches render errors like any error boundary,
// and exposes fail() for everything else (async, timers, handlers) through context
// and the registry. Exactly one report per failure: once the region is in its error
// state, further errors are ignored until Retry starts a new attempt (R6.4).

interface RegionApi {
  fail(err: unknown): void;
  region: ReportRegion;
  screenId: string | null;
}

const RegionContext = createContext<RegionApi | null>(null);

export function useRegion(): RegionApi {
  const ctx = useContext(RegionContext);
  if (!ctx) throw new Error("useRegion outside a <Region>");
  return ctx;
}

interface Props {
  region: ReportRegion;
  screenId: string | null;
  elementKey?: string;
  /** Message shown in the error state (or derived from the error). Defaults to the error's message. */
  message?: string | ((error: Error) => string);
  className?: string;
  onRetry?: () => void;
  children: ReactNode;
}

interface State {
  error: Error | null;
  attempt: number;
}

function messageFor(message: Props["message"], error: Error): string {
  if (typeof message === "function") return message(error);
  return message ?? error.message;
}

export class Region extends Component<Props, State> {
  state: State = { error: null, attempt: 0 };
  private mounted = false;
  private reportedAttempt = -1;
  private unregister: (() => void) | null = null;
  private api: RegionApi;

  constructor(props: Props) {
    super(props);
    this.api = { fail: this.fail, region: props.region, screenId: props.screenId };
  }

  static getDerivedStateFromError(error: unknown): Partial<State> {
    return { error: toError(error) };
  }

  componentDidCatch(error: unknown) {
    this.reportOnce(error);
  }

  componentDidMount() {
    this.mounted = true;
    this.register();
  }

  componentDidUpdate(prev: Props) {
    if (prev.region !== this.props.region || prev.screenId !== this.props.screenId) {
      this.api = { fail: this.fail, region: this.props.region, screenId: this.props.screenId };
      this.register();
    }
  }

  componentWillUnmount() {
    this.mounted = false;
    this.unregister?.();
  }

  private register() {
    this.unregister?.();
    this.unregister = registerRegion(this.props.region, this.props.screenId, this.fail);
  }

  fail = (err: unknown) => {
    // R6.6: a region that's gone changes nothing. Cancellations are not failures.
    if (!this.mounted || isCancel(err) || this.state.error) return;
    this.reportOnce(err);
    this.setState({ error: toError(err) });
  };

  private reportOnce(err: unknown) {
    if (this.reportedAttempt === this.state.attempt) return;
    this.reportedAttempt = this.state.attempt;
    const { region, screenId, elementKey } = this.props;
    reportFailure(err, elementKey ? { region, screenId, elementKey } : { region, screenId });
  }

  private retry = () => {
    this.setState((s) => ({ error: null, attempt: s.attempt + 1 }));
    this.props.onRetry?.();
  };

  render() {
    const { error, attempt } = this.state;
    if (error) {
      return (
        <div className={`region-error ${this.props.className ?? ""}`} role="alert">
          <IconAlert className="region-error__icon" />
          <span className="region-error__msg">{messageFor(this.props.message, error)}</span>
          <button type="button" className="btn btn--small" onClick={this.retry}>
            <IconRetry />
            Retry
          </button>
        </div>
      );
    }
    return (
      <RegionContext.Provider value={this.api} key={attempt}>
        {this.props.children}
      </RegionContext.Provider>
    );
  }
}
