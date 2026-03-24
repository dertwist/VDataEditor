/**
 * Enhanced startup performance profiler for VDataEditor.
 * Tracks all startup phases and provides detailed metrics.
 *
 * Usage:
 *   1. Included automatically in index.html
 *   2. Access metrics via: window.StartupProfiler.getReport()
 *   3. View in console: window.StartupProfiler.printReport()
 *
 * @global StartupProfiler
 */
(function () {
  'use strict';

  // Mark the absolute start of startup
  const appStartTime = typeof performance !== 'undefined' ? performance.now() : Date.now();

  const phases = [];
  let currentPhase = null;
  let phaseStartTime = 0;

  /**
   * Mark the start of a startup phase.
   * @param {string} name - Phase name (e.g., 'script-loading', 'schema-fetch')
   * @param {object} metadata - Optional metadata object
   */
  function startPhase(name, metadata = {}) {
    if (currentPhase) {
      endPhase();
    }
    currentPhase = { name, metadata, startTime: performance.now(), startMark: appStartTime };
    if (typeof performance !== 'undefined' && performance.mark) {
      try {
        performance.mark('startup:' + name + '-start');
      } catch (_) {}
    }
  }

  /**
   * Mark the end of current phase.
   */
  function endPhase() {
    if (!currentPhase) return;
    const duration = performance.now() - currentPhase.startTime;
    const phase = {
      name: currentPhase.name,
      duration: parseFloat(duration.toFixed(2)),
      metadata: currentPhase.metadata,
      timestamp: new Date().toISOString()
    };
    phases.push(phase);

    if (typeof performance !== 'undefined' && performance.mark) {
      try {
        performance.mark('startup:' + currentPhase.name + '-end');
        performance.measure(
          'startup:' + currentPhase.name,
          'startup:' + currentPhase.name + '-start',
          'startup:' + currentPhase.name + '-end'
        );
      } catch (_) {}
    }

    currentPhase = null;
  }

  /**
   * Record a milestone event during a phase.
   * @param {string} event - Event name
   * @param {object} data - Event data
   */
  function recordMilestone(event, data = {}) {
    if (!phases.length || !phases[phases.length - 1].milestones) {
      if (phases.length > 0) {
        phases[phases.length - 1].milestones = [];
      }
    }
    if (phases.length > 0 && phases[phases.length - 1].milestones) {
      phases[phases.length - 1].milestones.push({
        event,
        time: performance.now() - appStartTime,
        data
      });
    }
  }

  /**
   * Get full startup report.
   * @returns {object} Complete startup metrics
   */
  function getReport() {
    if (currentPhase) {
      endPhase();
    }

    const totalTime = performance.now() - appStartTime;
    const vdataMetrics = (typeof window !== 'undefined' && window.VDataPerf) ? window.VDataPerf.getMetrics() : null;

    return {
      appStartTime: new Date(Date.now() - totalTime).toISOString(),
      totalStartupTime: parseFloat(totalTime.toFixed(2)),
      phases: phases,
      schemaMetrics: vdataMetrics ? {
        lastSchemaLoad: vdataMetrics.lastSchemaLoad,
        lastSteps: vdataMetrics.lastSteps
      } : null,
      timestamp: new Date().toISOString()
    };
  }

  /**
   * Print formatted startup report to console.
   */
  function printReport() {
    const report = getReport();
    const indent = (n) => ' '.repeat(n);

    console.group('%c📊 VDataEditor Startup Performance Report', 'color: #2196F3; font-weight: bold; font-size: 14px');
    console.log(`%cTotal Startup Time: ${report.totalStartupTime.toFixed(1)}ms`, 'color: #4CAF50; font-weight: bold');
    console.log(`%cReport Time: ${report.timestamp}`, 'color: #666');

    console.group('%c⏱️ Startup Phases', 'color: #FF9800; font-weight: bold');
    phases.forEach((phase, idx) => {
      const barLength = Math.ceil(phase.duration / 10); // Scale for readability
      const bar = '█'.repeat(barLength);
      console.log(
        `${idx + 1}. ${phase.name.padEnd(25)} ${bar} ${phase.duration.toFixed(1).padStart(7)}ms`,
        phase.metadata && Object.keys(phase.metadata).length > 0 ? phase.metadata : ''
      );
      if (phase.milestones && phase.milestones.length > 0) {
        phase.milestones.forEach((m) => {
          console.log(`${indent(4)}→ ${m.event} (+${m.time.toFixed(1)}ms)`);
        });
      }
    });
    console.groupEnd();

    if (report.schemaMetrics) {
      console.group('%c🗂️ Schema Loading Metrics', 'color: #9C27B0; font-weight: bold');
      if (report.schemaMetrics.lastSchemaLoad) {
        const sl = report.schemaMetrics.lastSchemaLoad;
        console.log(`Game: ${sl.game}`);
        console.log(`Source: ${sl.source}`);
        console.log(`Total Time: ${sl.msTotal ? sl.msTotal.toFixed(1) + 'ms' : 'unknown'}`);
      }
      if (report.schemaMetrics.lastSteps) {
        const steps = report.schemaMetrics.lastSteps;
        if (steps.gunzipDecompressMs != null) {
          console.log(`  → Decompress: ${steps.gunzipDecompressMs.toFixed(1)}ms`);
        }
        if (steps.gunzipParseMs != null) {
          console.log(`  → Parse (gzip): ${steps.gunzipParseMs.toFixed(1)}ms`);
        }
        if (steps.localParseMs != null) {
          console.log(`  → Parse (local): ${steps.localParseMs.toFixed(1)}ms`);
        }
      }
      console.groupEnd();
    }

    console.group('%c⚡ Quick Insights', 'color: #4CAF50; font-weight: bold');
    const longestPhase = phases.reduce((max, p) => p.duration > max.duration ? p : max, phases[0]);
    if (longestPhase) {
      const pct = ((longestPhase.duration / report.totalStartupTime) * 100).toFixed(1);
      console.log(`Longest phase: ${longestPhase.name} (${longestPhase.duration.toFixed(1)}ms, ${pct}% of total)`);
    }

    const schemaTime = report.schemaMetrics?.lastSchemaLoad?.msTotal || 0;
    if (schemaTime > 0) {
      const schemaPct = ((schemaTime / report.totalStartupTime) * 100).toFixed(1);
      console.log(`Schema loading: ${schemaTime.toFixed(1)}ms (${schemaPct}% of total)`);
    }
    console.groupEnd();

    console.groupEnd();

    // Also return report for programmatic access
    return report;
  }

  /**
   * Export metrics as JSON for external analysis.
   * @returns {string} JSON string of metrics
   */
  function exportJSON() {
    return JSON.stringify(getReport(), null, 2);
  }

  // Expose API
  if (typeof window !== 'undefined') {
    window.StartupProfiler = {
      startPhase: startPhase,
      endPhase: endPhase,
      recordMilestone: recordMilestone,
      getReport: getReport,
      printReport: printReport,
      exportJSON: exportJSON
    };

    // Auto-start app phase tracking
    startPhase('app-startup', { description: 'Total application startup' });
  }
})();
