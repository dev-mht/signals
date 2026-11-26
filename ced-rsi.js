/* CED Signals — RSI+ (passe 27)
 *
 * Fichier GÉNÉRÉ : calcul identique à apps/terminal/src/lib/chart/ced/ced-rsi.ts (passe 22 de Hypeterminal),
 * compilé en JavaScript simple (RSI de Wilder lissé, pivots, divergences, pré-divergences, zones).
 * Chargé AVANT le script de index.html. Expose window.CED_RSI.
 * Pour le régénérer après une modification de ced-rsi.ts : tsc + même enveloppe (voir le compte rendu de la passe 27).
 */
(() => {
  'use strict'
  if (window.CED_RSI) return
function rma(values, length) {
    var _a, _b;
    const out = [];
    let sum = 0;
    for (let i = 0; i < values.length; i += 1) {
        const value = (_a = values[i]) !== null && _a !== void 0 ? _a : 0;
        if (i < length - 1) {
            sum += value;
            out.push(Number.NaN);
        }
        else if (i === length - 1) {
            sum += value;
            out.push(sum / length);
        }
        else {
            const prev = (_b = out[i - 1]) !== null && _b !== void 0 ? _b : value;
            out.push((prev * (length - 1) + value) / length);
        }
    }
    return out;
}
const DEFAULT_RSI_PARAMS = {
    rsiLen: 14,
    smoothLen: 5,
    pivotLeft: 5,
    pivotRight: 3,
    minGap: 5,
    maxGap: 60,
    sideLevel: 50,
    oversold: 30,
    overbought: 70,
    showHidden: false,
};
function positiveInt(value, fallback) {
    return Number.isFinite(value) && value >= 1 ? Math.round(value) : fallback;
}
/** Remplace les réglages invalides par ceux par défaut et garde des entiers positifs là où il en faut. */
function normalizeRsiParams(params = {}) {
    const merged = { ...DEFAULT_RSI_PARAMS, ...params };
    return {
        ...merged,
        rsiLen: positiveInt(merged.rsiLen, DEFAULT_RSI_PARAMS.rsiLen),
        smoothLen: positiveInt(merged.smoothLen, DEFAULT_RSI_PARAMS.smoothLen),
        pivotLeft: positiveInt(merged.pivotLeft, DEFAULT_RSI_PARAMS.pivotLeft),
        pivotRight: positiveInt(merged.pivotRight, DEFAULT_RSI_PARAMS.pivotRight),
        minGap: positiveInt(merged.minGap, DEFAULT_RSI_PARAMS.minGap),
        maxGap: positiveInt(merged.maxGap, DEFAULT_RSI_PARAMS.maxGap),
    };
}
/** EMA qui ignore le début de série (NaN) et démarre sur la première valeur valide. */
function emaSkippingNaN(values, length) {
    const alpha = 2 / (length + 1);
    let prev = Number.NaN;
    return values.map((value) => {
        if (!Number.isFinite(value))
            return Number.NaN;
        prev = Number.isFinite(prev) ? alpha * value + (1 - alpha) * prev : value;
        return prev;
    });
}
/** RSI de Wilder sur les clôtures, puis lissage par EMA. Valeurs entre 0 et 100, NaN pendant l'amorçage. */
function computeRsiLisse(closes, rsiLen, smoothLen) {
    var _a, _b;
    const gains = [];
    const losses = [];
    for (let i = 0; i < closes.length; i += 1) {
        const change = i === 0 ? 0 : ((_a = closes[i]) !== null && _a !== void 0 ? _a : 0) - ((_b = closes[i - 1]) !== null && _b !== void 0 ? _b : 0);
        gains.push(Math.max(change, 0));
        losses.push(Math.max(-change, 0));
    }
    const avgGain = rma(gains, rsiLen);
    const avgLoss = rma(losses, rsiLen);
    const raw = avgGain.map((gain, i) => {
        var _a;
        const loss = (_a = avgLoss[i]) !== null && _a !== void 0 ? _a : Number.NaN;
        if (!Number.isFinite(gain) || !Number.isFinite(loss))
            return Number.NaN;
        if (loss === 0)
            return gain === 0 ? 50 : 100;
        return 100 - 100 / (1 + gain / loss);
    });
    return emaSkippingNaN(raw, smoothLen);
}
/**
 * Creux et sommets confirmés d'une série : un pivot est moins extrême que ses `left` voisines de gauche
 * (égalité permise) et strictement moins extrême que ses `right` voisines de droite. Le pivot n'est donc connu
 * que `right` bougies après coup, et le calcul ne regarde jamais plus loin. `limit` exclut les bougies au-delà.
 */
function findPivots(values, left, right, limit = values.length) {
    const pivots = [];
    const end = Math.min(limit, values.length);
    for (let i = left; i + right < end; i += 1) {
        const value = values[i];
        if (value === undefined || !Number.isFinite(value))
            continue;
        let isLow = true;
        let isHigh = true;
        for (let j = i - left; j <= i + right; j += 1) {
            if (j === i)
                continue;
            const other = values[j];
            if (other === undefined || !Number.isFinite(other)) {
                isLow = false;
                isHigh = false;
                break;
            }
            if (j < i) {
                if (other < value)
                    isLow = false;
                if (other > value)
                    isHigh = false;
            }
            else {
                if (other <= value)
                    isLow = false;
                if (other >= value)
                    isHigh = false;
            }
        }
        if (isLow)
            pivots.push({ index: i, value, type: "low" });
        else if (isHigh)
            pivots.push({ index: i, value, type: "high" });
    }
    return pivots;
}
function finiteOr(value, fallback) {
    return value !== undefined && Number.isFinite(value) ? value : fallback;
}
/**
 * Divergences entre deux pivots consécutifs de même type.
 * Haussière : le prix fait un creux plus bas, l'oscillateur un creux plus haut (sous `sideLevel`).
 * Baissière : le prix fait un sommet plus haut, l'oscillateur un sommet plus bas (au-dessus de `sideLevel`).
 * Cachées (si activées) : l'inverse, signe d'une tendance qui continue.
 * `lows` et `highs` sont les plus bas et plus hauts de chaque bougie, alignés sur les pivots.
 */
function findDivergences(lows, highs, pivots, params) {
    const out = [];
    let prevLow;
    let prevHigh;
    for (const pivot of pivots) {
        const isLow = pivot.type === "low";
        const prev = isLow ? prevLow : prevHigh;
        if (isLow)
            prevLow = pivot;
        else
            prevHigh = pivot;
        if (!prev)
            continue;
        const gap = pivot.index - prev.index;
        if (gap < params.minGap || gap > params.maxGap)
            continue;
        const prices = isLow ? lows : highs;
        const fromPrice = finiteOr(prices[prev.index], Number.NaN);
        const toPrice = finiteOr(prices[pivot.index], Number.NaN);
        if (!Number.isFinite(fromPrice) || !Number.isFinite(toPrice))
            continue;
        let kind;
        if (isLow) {
            if (toPrice < fromPrice && pivot.value > prev.value && pivot.value <= params.sideLevel)
                kind = "bullish";
            else if (params.showHidden && toPrice > fromPrice && pivot.value < prev.value)
                kind = "hiddenBullish";
        }
        else if (toPrice > fromPrice && pivot.value < prev.value && pivot.value >= params.sideLevel) {
            kind = "bearish";
        }
        else if (params.showHidden && toPrice < fromPrice && pivot.value > prev.value) {
            kind = "hiddenBearish";
        }
        if (!kind)
            continue;
        out.push({
            kind,
            fromIndex: prev.index,
            toIndex: pivot.index,
            fromValue: prev.value,
            toValue: pivot.value,
            fromPrice,
            toPrice,
            confirmedAt: pivot.index + params.pivotRight,
            pending: false,
        });
    }
    return out;
}
/**
 * Pré-divergence : parmi les `pivotRight` dernières bougies, l'extrême de l'oscillateur n'est pas encore un pivot
 * confirmé, mais il forme déjà une divergence avec le dernier pivot confirmé et l'oscillateur a commencé à se
 * retourner. Résultat prévisionnel : il peut disparaître si le mouvement repart dans l'autre sens.
 * Les tableaux ne contiennent que des bougies closes (voir `analyzeRsi`).
 */
function findPreDivergences(lows, highs, osc, pivots, params) {
    const n = osc.length;
    const out = [];
    if (n < 2)
        return out;
    const start = Math.max(0, n - params.pivotRight);
    for (const type of ["low", "high"]) {
        const isLow = type === "low";
        let last;
        for (const pivot of pivots)
            if (pivot.type === type)
                last = pivot;
        if (!last)
            continue;
        // Candidat : extrême de l'oscillateur dans la fenêtre non confirmée.
        let c = -1;
        for (let i = start; i < n; i += 1) {
            const value = osc[i];
            if (value === undefined || !Number.isFinite(value))
                continue;
            const best = c >= 0 ? osc[c] : undefined;
            if (best === undefined || (isLow ? value < best : value > best))
                c = i;
        }
        if (c <= last.index || c >= n - 1)
            continue;
        const candidate = osc[c];
        const latest = osc[n - 1];
        if (candidate === undefined || latest === undefined || !Number.isFinite(candidate) || !Number.isFinite(latest)) {
            continue;
        }
        // L'oscillateur doit déjà s'être retourné depuis ce candidat.
        if (isLow ? latest <= candidate : latest >= candidate)
            continue;
        // Le candidat doit être au moins aussi extrême que ses voisines de gauche, comme un vrai pivot.
        let leftOk = true;
        for (let j = Math.max(0, c - params.pivotLeft); j < c; j += 1) {
            const other = osc[j];
            if (other === undefined || !Number.isFinite(other) || (isLow ? other < candidate : other > candidate)) {
                leftOk = false;
                break;
            }
        }
        if (!leftOk)
            continue;
        const gap = c - last.index;
        if (gap < params.minGap || gap > params.maxGap)
            continue;
        const prices = isLow ? lows : highs;
        const fromPrice = finiteOr(prices[last.index], Number.NaN);
        const toPrice = finiteOr(prices[c], Number.NaN);
        if (!Number.isFinite(fromPrice) || !Number.isFinite(toPrice))
            continue;
        const diverges = isLow
            ? toPrice < fromPrice && candidate > last.value && candidate <= params.sideLevel
            : toPrice > fromPrice && candidate < last.value && candidate >= params.sideLevel;
        if (!diverges)
            continue;
        out.push({
            kind: isLow ? "bullish" : "bearish",
            fromIndex: last.index,
            toIndex: c,
            fromValue: last.value,
            toValue: candidate,
            fromPrice,
            toPrice,
            pending: true,
        });
    }
    return out;
}
/** Plages de bougies consécutives en survente (`<= low`) ou en surchauffe (`>= high`), pour les bandes verticales. */
function findExtremeZones(values, low, high) {
    const zones = [];
    let current;
    for (let i = 0; i < values.length; i += 1) {
        const value = values[i];
        let kind;
        if (value !== undefined && Number.isFinite(value)) {
            if (value <= low)
                kind = "oversold";
            else if (value >= high)
                kind = "overbought";
        }
        if (current && kind === current.kind) {
            current.to = i;
            continue;
        }
        if (current)
            zones.push(current);
        current = kind ? { from: i, to: i, kind } : undefined;
    }
    if (current)
        zones.push(current);
    return zones;
}
/**
 * Analyse complète. `forming` : la dernière bougie est encore en cours de formation ; la ligne du RSI l'inclut,
 * mais pivots et divergences ne s'appuient que sur les bougies closes (pas de signal qui bouge à chaque tick).
 */
function analyzeRsi(data, params = DEFAULT_RSI_PARAMS, forming = false) {
    const p = normalizeRsiParams(params);
    const values = computeRsiLisse(data.map((bar) => bar.close), p.rsiLen, p.smoothLen);
    const limit = forming && data.length > 0 ? data.length - 1 : data.length;
    const closed = data.slice(0, limit);
    const osc = values.slice(0, limit);
    const lows = closed.map((bar) => bar.low);
    const highs = closed.map((bar) => bar.high);
    const pivots = findPivots(osc, p.pivotLeft, p.pivotRight);
    return {
        values,
        pivots,
        divergences: findDivergences(lows, highs, pivots, p),
        pre: findPreDivergences(lows, highs, osc, pivots, p),
        zones: findExtremeZones(values, p.oversold, p.overbought),
    };
}

  // Les bougies de la page Signals (t, o, h, l, c) → format attendu par analyzeRsi.
  // Ne reçoit que des bougies CLOSES : aucun signal ne bouge à chaque tick.
  function analyzeBars(bars, params) {
    const data = bars.map(b => ({ timestamp: b.t, open: b.o, high: b.h, low: b.l, close: b.c }))
    return analyzeRsi(data, params || DEFAULT_RSI_PARAMS, false)
  }

  window.CED_RSI = { analyzeBars, analyzeRsi, computeRsiLisse, findPivots, findDivergences, findPreDivergences, findExtremeZones, normalizeRsiParams, DEFAULT_RSI_PARAMS }
})()
