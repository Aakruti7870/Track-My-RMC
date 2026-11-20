const assert = require("node:assert/strict");

async function assertHomeCardRow(row, { count, shouldOverflow } = {}) {
  const result = await row.evaluate(async (node, expectedOverflow) => {
    function measure() {
      const bounds = node.getBoundingClientRect();
      const style = getComputedStyle(node);
      const scrollable = style.overflowX === "auto" || style.overflowX === "scroll";
      const cards = Array.from(scrollable ? node.firstElementChild.children : node.children);
      const cardBounds = cards.map(card => card.getBoundingClientRect());
      const last = cards.at(-1);
      const overflow = node.scrollWidth > node.clientWidth + 1;
      const aligned = cardBounds.every(card => Math.abs(card.top - cardBounds[0].top) < 1);
      const readable = cards.every(card => card.clientWidth > 0 && card.scrollWidth <= card.clientWidth + 1);
      node.scrollLeft = node.scrollWidth;
      const lastBounds = last?.getBoundingClientRect();
      const reachedEnd = lastBounds && lastBounds.right <= bounds.right + 1 && lastBounds.left >= bounds.left - 1;
      node.scrollLeft = 0;
      return {
        id: node.dataset.testid, count: cards.length, overflow, aligned, readable, reachedEnd,
        viewport: innerWidth, rowWidth: bounds.width, contentWidth: node.scrollWidth,
        inViewport: bounds.left >= -1 && bounds.right <= innerWidth + 1,
        scrollable,
        hiddenScrollbar: style.scrollbarWidth === "none",
      };
    }

    // React Native Web reports the measured width asynchronously after a viewport change.
    let metrics = measure();
    for (let frame = 0; frame < 12 && (!metrics.reachedEnd
      || (expectedOverflow !== undefined && metrics.overflow !== expectedOverflow)); frame++) {
      await new Promise(resolve => requestAnimationFrame(resolve));
      metrics = measure();
    }
    return metrics;
  }, shouldOverflow);
  const details = JSON.stringify(result);
  assert(result.count > 0 && result.aligned && result.readable && result.inViewport && result.reachedEnd, details);
  if (result.count > 1) assert(result.hiddenScrollbar && result.scrollable, details);
  else assert.equal(result.overflow, false, details);
  if (count !== undefined) assert.equal(result.count, count, details);
  if (shouldOverflow !== undefined) assert.equal(result.overflow, shouldOverflow, details);
  return result.overflow;
}

module.exports = { assertHomeCardRow };
