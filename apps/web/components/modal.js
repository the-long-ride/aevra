import { escapeHtml } from '../core/dom.js';

let activeModal;

export function closeModal() {
  activeModal?.remove();
  activeModal = null;
}

export function openModal(title, body, { footer = '', onReady } = {}) {
  closeModal();
  const backdrop = document.createElement('div');
  backdrop.className = 'modal-backdrop';
  backdrop.innerHTML = `
    <section class="modal" role="dialog" aria-modal="true">
      <header class="modal-head">
        <h2>${escapeHtml(title)}</h2>
        <button type="button" class="modal-close" data-modal-close aria-label="Close">×</button>
      </header>
      <div class="modal-body">${body}</div>
      ${footer ? `<footer class="modal-foot">${footer}</footer>` : ''}
    </section>`;
  backdrop.addEventListener('click', (event) => {
    if (event.target === backdrop || event.target.closest('[data-modal-close]')) {
      closeModal();
    }
  });
  document.body.append(backdrop);
  activeModal = backdrop;
  onReady?.(backdrop.querySelector('.modal-body'), backdrop);
  return backdrop;
}
