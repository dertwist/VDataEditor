/**
 * Lightweight schema / load timings (Performance API + console).
 * @global VDataPerf
 */
(function () {
  'use strict';

  var PREFIX = 'vdata:';
  var lastSchemaLoad = null;
  var lastSteps = null;

  function canPerf() {
    return typeof performance !== 'undefined' && typeof performance.mark === 'function';
  }

  function mark(name) {
    if (!canPerf()) return;
    try {
      performance.mark(PREFIX + name);
    } catch (_) {}
  }

  function measure(label, startName, endName) {
    if (!canPerf()) return null;
    try {
      performance.measure(PREFIX + label, PREFIX + startName, PREFIX + endName);
      var e = performance.getEntriesByName(PREFIX + label).pop();
      return e ? e.duration : null;
    } catch (_) {
      return null;
    }
  }

  function recordSchemaLoad(meta) {
    lastSchemaLoad = meta || null;
    if (meta && typeof console !== 'undefined' && console.info) {
      console.info('[VDataPerf] schema load', meta);
    }
  }

  function recordSchemaSteps(steps) {
    lastSteps = steps && typeof steps === 'object' ? steps : null;
  }

  function getLastSchemaLoad() {
    return lastSchemaLoad;
  }

  function getLastSteps() {
    return lastSteps;
  }

  function getMetrics() {
    var measures = [];
    if (canPerf() && typeof performance.getEntriesByType === 'function') {
      try {
        var all = performance.getEntriesByType('measure');
        for (var i = 0; i < all.length; i++) {
          if (all[i].name.indexOf(PREFIX) === 0) measures.push({ name: all[i].name, duration: all[i].duration });
        }
      } catch (_) {}
    }
    return {
      lastSchemaLoad: lastSchemaLoad,
      lastSteps: lastSteps,
      measures: measures
    };
  }

  function clearMetrics() {
    lastSchemaLoad = null;
    lastSteps = null;
    if (canPerf() && typeof performance.clearMarks === 'function') {
      try {
        performance.clearMarks();
        performance.clearMeasures();
      } catch (_) {}
    }
  }

  function logSchemaPhaseSummary() {
    if (!lastSchemaLoad && !lastSteps) return;
    var lines = [];
    if (lastSchemaLoad) lines.push('Total load: ' + (lastSchemaLoad.msTotal != null ? lastSchemaLoad.msTotal.toFixed(1) + 'ms' : '?'));
    if (lastSteps) {
      if (lastSteps.gunzipDecompressMs != null) lines.push('  Decompress: ' + lastSteps.gunzipDecompressMs.toFixed(1) + 'ms');
      if (lastSteps.gunzipParseMs != null) lines.push('  Parse (gzip path): ' + lastSteps.gunzipParseMs.toFixed(1) + 'ms');
      if (lastSteps.localParseMs != null) lines.push('  Parse (local): ' + lastSteps.localParseMs.toFixed(1) + 'ms');
    }
    if (typeof console !== 'undefined' && console.info) console.info('[VDataPerf] breakdown\n' + lines.join('\n'));
  }

  if (typeof window !== 'undefined') {
    window.VDataPerf = {
      mark: mark,
      measure: measure,
      recordSchemaLoad: recordSchemaLoad,
      recordSchemaSteps: recordSchemaSteps,
      logSchemaPhaseSummary: logSchemaPhaseSummary,
      getLastSchemaLoad: getLastSchemaLoad,
      getLastSteps: getLastSteps,
      getMetrics: getMetrics,
      clearMetrics: clearMetrics
    };
  }
})();
