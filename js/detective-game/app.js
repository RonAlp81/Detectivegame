const { useReducer } = React;

const START_REPUTATION = 70;
const REPUTATION_COST_PER_ACTION = 1; // every evidence check / interview costs a little credibility
const REPUTATION_REWARD_CORRECT = 20;
const REPUTATION_PENALTY_WRONG = 30;

function clampReputation(value) {
  return Math.max(0, Math.min(100, value));
}

function createInitialState(activeCase) {
  return {
    caseId: activeCase.id,
    hoursElapsed: 0,
    reputation: START_REPUTATION,
    examinedEvidence: {},
    interviewedSuspects: {},
    selectedSuspectId: null,
    confirming: false,
    finished: false,
    outcome: null, // 'correct' | 'wrong'
  };
}

function reducer(state, action) {
  switch (action.type) {
    case "EXAMINE_EVIDENCE": {
      if (state.finished || state.examinedEvidence[action.id]) return state;
      return {
        ...state,
        examinedEvidence: { ...state.examinedEvidence, [action.id]: true },
        hoursElapsed: state.hoursElapsed + action.hoursCost,
        reputation: clampReputation(state.reputation - REPUTATION_COST_PER_ACTION),
      };
    }
    case "INTERVIEW_SUSPECT": {
      if (state.finished || state.interviewedSuspects[action.id]) return state;
      return {
        ...state,
        interviewedSuspects: { ...state.interviewedSuspects, [action.id]: true },
        hoursElapsed: state.hoursElapsed + action.hoursCost,
        reputation: clampReputation(state.reputation - REPUTATION_COST_PER_ACTION),
      };
    }
    case "SELECT_SUSPECT":
      if (state.finished) return state;
      return { ...state, selectedSuspectId: action.id };
    case "OPEN_CONFIRM":
      return state.selectedSuspectId ? { ...state, confirming: true } : state;
    case "CLOSE_CONFIRM":
      return { ...state, confirming: false };
    case "FINISH_CASE": {
      const isCorrect = state.selectedSuspectId === action.guiltySuspectId;
      const reputationDelta = isCorrect ? REPUTATION_REWARD_CORRECT : -REPUTATION_PENALTY_WRONG;
      return {
        ...state,
        confirming: false,
        finished: true,
        outcome: isCorrect ? "correct" : "wrong",
        reputation: clampReputation(state.reputation + reputationDelta),
      };
    }
    case "RESET":
      return createInitialState(action.activeCase);
    default:
      return state;
  }
}

function formatElapsedTime(hoursElapsed) {
  const days = Math.floor(hoursElapsed / 24);
  const hours = hoursElapsed % 24;
  if (days === 0) return `${hours} שעות`;
  return `${days} ימים ו-${hours} שעות`;
}

function reputationTone(reputation) {
  if (reputation >= 60) return "good";
  if (reputation >= 30) return "warn";
  return "bad";
}

function StatsBar({ hoursElapsed, reputation }) {
  return (
    <div className="stats-bar">
      <div className="stat">
        <span className="stat-label">זמן חקירה</span>
        <span className="stat-value">{formatElapsedTime(hoursElapsed)}</span>
      </div>
      <div className="stat stat-reputation">
        <span className="stat-label">מוניטין</span>
        <div className="reputation-track" role="meter" aria-valuenow={reputation} aria-valuemin={0} aria-valuemax={100}>
          <div className={`reputation-fill tone-${reputationTone(reputation)}`} style={{ width: `${reputation}%` }} />
        </div>
        <span className="stat-value">{reputation}/100</span>
      </div>
    </div>
  );
}

function EvidenceCard({ evidence, examined, onExamine }) {
  return (
    <li className={`case-card${examined ? " is-open" : ""}`}>
      <button type="button" className="case-card-head" onClick={() => onExamine(evidence)}>
        <span className="case-card-icon" aria-hidden="true">{examined ? "🔎" : "🗂️"}</span>
        <span className="case-card-title">{evidence.name}</span>
        {!examined && <span className="case-card-cost">{evidence.hoursCost} שעות</span>}
      </button>
      <p className="case-card-summary">{evidence.summary}</p>
      {examined && <p className="case-card-details">{evidence.details}</p>}
    </li>
  );
}

function SuspectCard({ suspect, interviewed, selected, disabled, onInterview, onSelect }) {
  return (
    <li className={`case-card suspect-card${interviewed ? " is-open" : ""}${selected ? " is-selected" : ""}`}>
      <div className="case-card-head">
        <span className="case-card-icon" aria-hidden="true">🕵️</span>
        <span className="case-card-title">{suspect.name}</span>
        <span className="suspect-role">{suspect.role}</span>
      </div>
      <p className="case-card-summary">{suspect.profile}</p>
      {!interviewed ? (
        <button type="button" className="btn btn-outline" onClick={() => onInterview(suspect)}>
          חקירת חשוד ({suspect.hoursCost} שעות)
        </button>
      ) : (
        <p className="case-card-details">{suspect.interview}</p>
      )}
      <button
        type="button"
        className={`btn btn-accuse${selected ? " is-active" : ""}`}
        disabled={disabled}
        onClick={() => onSelect(suspect.id)}
      >
        {selected ? "נבחר/ה כחשוד/ה בתיק" : "בחר/י כחשוד/ה בתיק"}
      </button>
    </li>
  );
}

function ConfirmDialog({ suspectName, onConfirm, onCancel }) {
  return (
    <div className="modal-backdrop" role="dialog" aria-modal="true">
      <div className="modal-box">
        <h2>סגירת התיק</h2>
        <p>
          את/ה עומד/ת להאשים את <strong>{suspectName}</strong> ולסגור את התיק. לא ניתן יהיה לחזור אחורה. להמשיך?
        </p>
        <div className="modal-actions">
          <button type="button" className="btn btn-ghost" onClick={onCancel}>ביטול</button>
          <button type="button" className="btn btn-primary" onClick={onConfirm}>כן, לסגור את התיק</button>
        </div>
      </div>
    </div>
  );
}

function ResultOverlay({ outcome, verdict, hoursElapsed, reputation, onReset }) {
  return (
    <div className="modal-backdrop" role="dialog" aria-modal="true">
      <div className={`modal-box result-box tone-${outcome === "correct" ? "good" : "bad"}`}>
        <h2>{outcome === "correct" ? "התיק נפתר!" : "התיק נסגר ללא פתרון"}</h2>
        <p>{outcome === "correct" ? verdict.correct : verdict.wrong}</p>
        <div className="result-summary">
          <span>זמן חקירה כולל: {formatElapsedTime(hoursElapsed)}</span>
          <span>מוניטין סופי: {reputation}/100</span>
        </div>
        <button type="button" className="btn btn-primary" onClick={onReset}>
          חקירה חדשה
        </button>
      </div>
    </div>
  );
}

function DetectiveGame({ activeCase }) {
  const [state, dispatch] = useReducer(reducer, activeCase, createInitialState);

  const handleExamine = (evidence) =>
    dispatch({ type: "EXAMINE_EVIDENCE", id: evidence.id, hoursCost: evidence.hoursCost });

  const handleInterview = (suspect) =>
    dispatch({ type: "INTERVIEW_SUSPECT", id: suspect.id, hoursCost: suspect.hoursCost });

  const handleSelectSuspect = (id) => dispatch({ type: "SELECT_SUSPECT", id });

  const selectedSuspect = activeCase.suspects.find((s) => s.id === state.selectedSuspectId);

  return (
    <div className="detective-app">
      <header className="case-header">
        <h1>{activeCase.title}</h1>
        <p>{activeCase.description}</p>
      </header>

      <StatsBar hoursElapsed={state.hoursElapsed} reputation={state.reputation} />

      <div className="case-columns">
        <section className="case-column">
          <h2>ראיות</h2>
          <ul className="case-card-list">
            {activeCase.evidence.map((evidence) => (
              <EvidenceCard
                key={evidence.id}
                evidence={evidence}
                examined={!!state.examinedEvidence[evidence.id]}
                onExamine={handleExamine}
              />
            ))}
          </ul>
        </section>

        <section className="case-column">
          <h2>חשודים</h2>
          <ul className="case-card-list">
            {activeCase.suspects.map((suspect) => (
              <SuspectCard
                key={suspect.id}
                suspect={suspect}
                interviewed={!!state.interviewedSuspects[suspect.id]}
                selected={state.selectedSuspectId === suspect.id}
                disabled={state.finished}
                onInterview={handleInterview}
                onSelect={handleSelectSuspect}
              />
            ))}
          </ul>
        </section>
      </div>

      <footer className="case-footer">
        <button
          type="button"
          className="btn btn-primary btn-finish"
          disabled={!state.selectedSuspectId || state.finished}
          onClick={() => dispatch({ type: "OPEN_CONFIRM" })}
        >
          סיום החקירה
        </button>
        {!state.selectedSuspectId && <p className="case-footer-hint">בחר/י חשוד/ה לפני סיום החקירה</p>}
      </footer>

      {state.confirming && selectedSuspect && (
        <ConfirmDialog
          suspectName={selectedSuspect.name}
          onConfirm={() => dispatch({ type: "FINISH_CASE", guiltySuspectId: activeCase.guiltySuspectId })}
          onCancel={() => dispatch({ type: "CLOSE_CONFIRM" })}
        />
      )}

      {state.finished && (
        <ResultOverlay
          outcome={state.outcome}
          verdict={activeCase.verdict}
          hoursElapsed={state.hoursElapsed}
          reputation={state.reputation}
          onReset={() => dispatch({ type: "RESET", activeCase })}
        />
      )}
    </div>
  );
}

const activeCase = window.DETECTIVE_CASES[0];
ReactDOM.createRoot(document.getElementById("root")).render(<DetectiveGame activeCase={activeCase} />);
