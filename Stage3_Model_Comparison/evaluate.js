// Stage 3 — scoring. Pure functions: no fetch, no model, no printing.
// `node test.js` checks them.

export function scoreResults(results) {

  if (results.length === 0) {
    return {total: 0, correct: 0, accuracy: 0, fallbacks: 0, avgMs: 0, mistakes: []};
  }

  const total = results.length;
  // const wrong = results.filter(r => r.predicted !== r.expected)
  const correct = results.filter(r => r.predicted === r.expected).length

  const accuracy = Math.round((correct/total) * 100);

  const fallbacks = results.filter( r => r.source.startsWith("rules:")).length;

  const avgMs = Math.round(
    results.reduce((sum, cur) => cur.ms + sum, 0)/ total
  );

  const mistakes = results
    .filter((r => r.predicted !== r.expected))
    .map( r => ({
      id: r.id,
      expected: r.expected,
      predicted: r. predicted
    }))

  return{
    total,
    correct,
    accuracy,
    fallbacks,
    avgMs,
    mistakes
  }
}


export function pickWinner(scoreboard) {

  if(scoreboard.length === 0) return null;

  let highest = scoreboard[0];
  for(const element of scoreboard){

    if(element.score.accuracy > highest.score.accuracy ||
      element.score.accuracy === highest.score.accuracy &&
      element.score.avgMs < highest.score.avgMs
    ){
      highest = element
    }
  }
  return highest.name;

}
