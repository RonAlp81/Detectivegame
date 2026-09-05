const { useReducer, useState } = React;

const START_REPUTATION = 70;
const REPUTATION_COST_PER_ACTION = 1; // every evidence check / interview action costs a little credibility
const REPUTATION_REWARD_CORRECT = 20;
const REPUTATION_PENALTY_WRONG = 30;
const QUESTION_HOURS_COST = 1; // every free-text question asked after the interview has started

function clampReputation(value) {
  return Math.max(0, Math.min(100, value));
}

// Splits text into word tokens, stripping punctuation but keeping Hebrew
// letters, latin letters and digits (so "VPN", "23:47" etc. still tokenize).
function tokenizeWords(text) {
  return text
    .replace(/[?!.,"'׳״():;]/g, " ")
    .split(/\s+/)
    .map((t) => t.trim())
    .filter(Boolean);
}

// Hebrew attaches single-letter prefixes (ה, ו, ב, כ, ל, מ, ש) to words, and
// verbs conjugate heavily (e.g. "היית" vs "היתה" vs "הייתם"). Stripping up to
// two leading prefix letters and then comparing by substring containment
// (rather than exact match) lets "שהייתה" match a keyword like "היית" even
// though the surface forms differ.
function stripHebrewPrefixes(token) {
  if (!/^[\u0590-\u05FF]+$/.test(token)) return token;
  let w = token;
  for (let i = 0; i < 2; i++) {
    if (w.length > 3 && "לבכמושה".includes(w[0])) {
      w = w.slice(1);
    } else {
      break;
    }
  }
  return w;
}

function wordsRoughlyMatch(a, b) {
  if (a === b) return true;
  if (a.length >= 3 && b.length >= 3) return a.includes(b) || b.includes(a);
  return false;
}

// Scores every topic on a suspect by how many of its keyword phrases are
// present in the player's free-text question, matching at the word level
// (with prefix-stripping and substring fuzziness) instead of requiring the
// exact phrase to appear verbatim. Returns the best match's answer, or the
// suspect's deflect line if nothing scores above zero.
function matchSuspectTopic(suspect, questionRaw) {
  const trimmed = questionRaw.trim();
  if (!trimmed) return null;

  const qTokens = tokenizeWords(trimmed).map(stripHebrewPrefixes);

  let bestTopic = null;
  let bestScore = 0;
  suspect.topics.forEach((topic) => {
    let score = 0;
    topic.keywords.forEach((kwPhrase) => {
      const kwTokens = tokenizeWords(kwPhrase).map(stripHebrewPrefixes);
      const matchedCount = kwTokens.filter((kwt) =>
        qTokens.some((qt) => wordsRoughlyMatch(qt, kwt))
      ).length;
      // Single-word keywords need one hit; multi-word phrases need at least
      // half their words to show up, so partial/rephrased questions still count.
      const threshold = kwTokens.length <= 1 ? 1 : Math.ceil(kwTokens.length / 2);
      if (matchedCount >= threshold) score += 1;
    });
    if (score > bestScore) {
      bestScore = score;
      bestTopic = topic;
    }
  });

  return bestTopic ? bestTopic.answer : suspect.deflect;
}

function createInitialState(activeCase) {
  return {
    caseId: activeCase.id,
    hoursElapsed: 0,
    reputation: START_REPUTATION,
    examinedEvidence: {},
    interviews: {}, // suspectId -> { started: bool, transcript: [{q, a}] }
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
    case "START_INTERVIEW": {
      if (state.finished || state.interviews[action.id]) return state;
      return {
        ...state,
        interviews: {
          ...state.interviews,
          [action.id]: { started: true, transcript: [] },
        },
        hoursElapsed: state.hoursElapsed + action.hoursCost,
        reputation: clampReputation(state.reputation - REPUTATION_COST_PER_ACTION),
      };
    }
    case "ASK_QUESTION": {
      if (state.finished) return state;
      const existing = state.interviews[action.id];
      if (!existing || !existing.started) return state;
      return {
        ...state,
        interviews: {
          ...state.interviews,
          [action.id]: {
            ...existing,
            transcript: [...existing.transcript, { q: action.question, a: action.answer }],
          },
        },
        hoursElapsed: state.hoursElapsed + QUESTION_HOURS_COST,
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

function InterviewPanel({ suspect, interview, disabled, onAskQuestion }) {
  const [draft, setDraft] = useState("");
  const [error, setError] = useState("");

  const handleAsk = () => {
    const trimmed = draft.trim();
    if (!trimmed) {
      setError("כתבו שאלה קודם.");
      return;
    }
    setError("");
    const answer = matchSuspectTopic(suspect, trimmed);
    onAskQuestion(suspect, trimmed, answer);
    setDraft("");
  };

  return (
    <div className="interview-panel">
      <div className="interview-transcript">
        <p className="interview-bubble interview-bubble-suspect">{suspect.opening}</p>
        {interview.transcript.map((turn, idx) => (
          <React.Fragment key={idx}>
            <p className="interview-bubble interview-bubble-you">{turn.q}</p>
            <p className="interview-bubble interview-bubble-suspect">{turn.a}</p>
          </React.Fragment>
        ))}
      </div>
      <div className="interview-input-row">
        <input
          type="text"
          className="interview-input"
          placeholder="לדוגמה: איפה היית באותו ערב?"
          value={draft}
          disabled={disabled}
          onChange={(e) => {
            setDraft(e.target.value);
            if (error) setError("");
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter") handleAsk();
          }}
        />
        <button type="button" className="btn btn-outline btn-ask" disabled={disabled} onClick={handleAsk}>
          שאל/י ({QUESTION_HOURS_COST} שעה)
        </button>
      </div>
      {error && <p className="interview-error">{error}</p>}
    </div>
  );
}

function SuspectCard({ suspect, interview, selected, disabled, onStartInterview, onAskQuestion, onSelect }) {
  return (
    <li className={`case-card suspect-card${interview ? " is-open" : ""}${selected ? " is-selected" : ""}`}>
      <div className="case-card-head">
        <span className="case-card-icon" aria-hidden="true">🕵️</span>
        <span className="case-card-title">{suspect.name}</span>
        <span className="suspect-role">{suspect.role}</span>
      </div>
      <p className="case-card-summary">{suspect.profile}</p>
      {!interview ? (
        <button type="button" className="btn btn-outline" onClick={() => onStartInterview(suspect)}>
          התחלת חקירה ({suspect.hoursCost} שעות)
        </button>
      ) : (
        <InterviewPanel
          suspect={suspect}
          interview={interview}
          disabled={disabled}
          onAskQuestion={onAskQuestion}
        />
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

function ResultOverlay({ outcome, verdict, hoursElapsed, reputation, onPlayAgain, onBackToCases }) {
  return (
    <div className="modal-backdrop" role="dialog" aria-modal="true">
      <div className={`modal-box result-box tone-${outcome === "correct" ? "good" : "bad"}`}>
        <h2>{outcome === "correct" ? "התיק נפתר!" : "התיק נסגר ללא פתרון"}</h2>
        <p>{outcome === "correct" ? verdict.correct : verdict.wrong}</p>
        <div className="result-summary">
          <span>זמן חקירה כולל: {formatElapsedTime(hoursElapsed)}</span>
          <span>מוניטין סופי: {reputation}/100</span>
        </div>
        <div className="modal-actions">
          <button type="button" className="btn btn-ghost" onClick={onPlayAgain}>לנסות תיק זה שוב</button>
          <button type="button" className="btn btn-primary" onClick={onBackToCases}>חזרה לרשימת התיקים</button>
        </div>
      </div>
    </div>
  );
}

function DetectiveGame({ activeCase, onBackToCases }) {
  const [state, dispatch] = useReducer(reducer, activeCase, createInitialState);

  const handleExamine = (evidence) =>
    dispatch({ type: "EXAMINE_EVIDENCE", id: evidence.id, hoursCost: evidence.hoursCost });

  const handleStartInterview = (suspect) =>
    dispatch({ type: "START_INTERVIEW", id: suspect.id, hoursCost: suspect.hoursCost });

  const handleAskQuestion = (suspect, question, answer) =>
    dispatch({ type: "ASK_QUESTION", id: suspect.id, question, answer });

  const handleSelectSuspect = (id) => dispatch({ type: "SELECT_SUSPECT", id });

  const selectedSuspect = activeCase.suspects.find((s) => s.id === state.selectedSuspectId);

  return (
    <div className="detective-app">
      <header className="case-header">
        <div className="case-header-top">
          <span className="difficulty-badge">{activeCase.difficulty}</span>
          <button type="button" className="btn btn-ghost btn-small" onClick={onBackToCases}>
            רשימת התיקים
          </button>
        </div>
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
                interview={state.interviews[suspect.id]}
                selected={state.selectedSuspectId === suspect.id}
                disabled={state.finished}
                onStartInterview={handleStartInterview}
                onAskQuestion={handleAskQuestion}
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
          onPlayAgain={() => dispatch({ type: "RESET", activeCase })}
          onBackToCases={onBackToCases}
        />
      )}
    </div>
  );
}

function CaseSelectScreen({ cases, onSelect }) {
  return (
    <div className="detective-app">
      <header className="case-header">
        <h1>תיקים פתוחים</h1>
        <p>בחר/י תיק להתחיל בחקירה. ככל שהתיק קשה יותר, כך יש יותר חשודים וראיות עמומות יותר.</p>
      </header>
      <ul className="case-select-list">
        {cases.map((c) => (
          <li key={c.id} className="case-card case-select-card">
            <div className="case-card-head">
              <span className="difficulty-badge">{c.difficulty}</span>
              <span className="case-card-title">{c.title}</span>
            </div>
            <p className="case-card-summary">{c.description}</p>
            <button type="button" className="btn btn-primary" onClick={() => onSelect(c.id)}>
              פתיחת התיק
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}

function App() {
  const cases = window.DETECTIVE_CASES;
  const [selectedCaseId, setSelectedCaseId] = useState(null);

  if (!selectedCaseId) {
    return <CaseSelectScreen cases={cases} onSelect={setSelectedCaseId} />;
  }

  const activeCase = cases.find((c) => c.id === selectedCaseId);
  return (
    <DetectiveGame
      key={activeCase.id}
      activeCase={activeCase}
      onBackToCases={() => setSelectedCaseId(null)}
    />
  );
}

ReactDOM.createRoot(document.getElementById("root")).render(<App />);
