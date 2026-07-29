const { performance } = require('perf_hooks');

const jsdom = require('jsdom');
const { JSDOM } = jsdom;
const dom = new JSDOM(`<!DOCTYPE html><html><body><div id="results"></div></body></html>`);
global.document = dom.window.document;

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

const entries = Array.from({length: 1000}, (_, i) => ({ german: 'Wort ' + i, origin: 'Origin ' + i }));

function testOneByOne() {
  const start = performance.now();
  for (let j = 0; j < 1000; j++) {
    const list = el('div', 'etym-list');
    for (const entry of entries) {
      const item = el('div', 'etym-item');
      item.append(el('span', 'etym-word', entry.german));
      item.append(el('p', 'etym-origin', entry.origin));
      list.append(item);
    }
  }
  return performance.now() - start;
}

function testArray() {
  const start = performance.now();
  for (let j = 0; j < 1000; j++) {
    const list = el('div', 'etym-list');
    const items = entries.map(entry => {
      const item = el('div', 'etym-item');
      item.append(el('span', 'etym-word', entry.german));
      item.append(el('p', 'etym-origin', entry.origin));
      return item;
    });
    list.append(...items);
  }
  return performance.now() - start;
}

function testFragment() {
  const start = performance.now();
  for (let j = 0; j < 1000; j++) {
    const list = el('div', 'etym-list');
    const fragment = document.createDocumentFragment();
    for (const entry of entries) {
      const item = el('div', 'etym-item');
      item.append(el('span', 'etym-word', entry.german));
      item.append(el('p', 'etym-origin', entry.origin));
      fragment.append(item);
    }
    list.append(fragment);
  }
  return performance.now() - start;
}


console.log('One by One:', testOneByOne());
console.log('Array:', testArray());
console.log('Fragment:', testFragment());
