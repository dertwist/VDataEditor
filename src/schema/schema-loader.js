/**
 * Bridge for parallel schema cache prefetch (see schema-db.js prefetchOtherGamesParallel).
 * Kept for compatibility with the performance integration layout.
 */
(function () {
  'use strict';

  /**
   * Warm IndexedDB for games other than `activeGame` in parallel.
   * @param {string} [activeGame]
   * @returns {Promise<void>}
   */
  function prefetchOtherGames(activeGame) {
    if (window.SchemaDB && typeof window.SchemaDB.prefetchOtherGamesParallel === 'function') {
      return window.SchemaDB.prefetchOtherGamesParallel(activeGame || 'cs2');
    }
    return Promise.resolve();
  }

  if (typeof window !== 'undefined') {
    window.VDataSchemaLoader = {
      prefetchOtherGames: prefetchOtherGames
    };
  }
})();
