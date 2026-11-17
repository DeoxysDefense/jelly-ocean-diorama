import './ui/styles.css';
import { App } from './core/App';

function fail(msg: string) {
  const el = document.createElement('div');
  el.className = 'fatal';
  el.innerHTML = `<h1>Jelly Ocean could not start</h1><p>${msg}</p>`;
  document.body.appendChild(el);
}

function hasWebGL2() {
  try {
    const c = document.createElement('canvas');
    return !!c.getContext('webgl2');
  } catch {
    return false;
  }
}

if (!hasWebGL2()) {
  fail('This experience needs WebGL2. Please use a recent Chrome, Edge or Firefox with hardware acceleration enabled.');
} else {
  try {
    const app = new App(document.getElementById('app')!);
    (window as any).__jelly = app;
    app.start();
  } catch (e) {
    console.error(e);
    fail(String((e as Error)?.message ?? e));
  }
}
