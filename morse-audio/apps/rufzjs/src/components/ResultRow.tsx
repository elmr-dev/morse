import { AttemptResult } from '../types';

interface ResultRowProps {
  result: AttemptResult;
}

function HighlightedCallsign({ sent, received }: { sent: string; received: string }) {
  const s = sent.toUpperCase();
  const r = received.toUpperCase();
  const maxLen = Math.max(s.length, r.length);

  const chars: JSX.Element[] = [];

  for (let i = 0; i < maxLen; i++) {
    const sentChar = s[i] || '';
    const recvChar = r[i] || '';
    const isCorrect = sentChar === recvChar && sentChar !== '';
    const isMissing = i >= r.length && i < s.length;
    const isExtra = i >= s.length && i < r.length;

    if (isCorrect) {
      chars.push(<span key={i} className="char-correct">{recvChar}</span>);
    } else if (isMissing) {
      chars.push(<span key={i} className="char-missing">_</span>);
    } else if (isExtra) {
      chars.push(<span key={i} className="char-wrong">{recvChar}</span>);
    } else {
      chars.push(<span key={i} className="char-wrong">{recvChar || '_'}</span>);
    }
  }

  return <span className="highlighted-callsign">{chars}</span>;
}

export function ResultRow({ result }: ResultRowProps) {
  const showHighlight = !result.correct && result.received;

  return (
    <tr className={result.correct ? 'correct' : 'incorrect'}>
      <td className="index">{result.index + 1}</td>
      <td className="sent">{result.sent}</td>
      <td className="received">
        {!result.received ? '-' : showHighlight ? (
          <HighlightedCallsign sent={result.sent} received={result.received} />
        ) : (
          result.received
        )}
      </td>
      <td className="speed">{result.speed}</td>
      <td className="points">{result.points}</td>
      <td className="status">
        {result.correct ? '✓' : '✗'}
        {result.replayed && ' ↺'}
      </td>
    </tr>
  );
}
