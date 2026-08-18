let stack;

function ensureStack() {
  if (stack?.isConnected) return stack;
  stack = document.querySelector('#toast-stack');
  if (!stack) {
    stack = document.createElement('div');
    stack.id = 'toast-stack';
    stack.className = 'toast-stack';
    document.body.append(stack);
  }
  return stack;
}

export function toast(message, kind = 'info', timeout = 4200) {
  const node = document.createElement('div');
  node.className = `toast ${kind} visible`;
  node.innerHTML = `<span class="toast-message"></span>`;
  node.querySelector('.toast-message').textContent = String(message);
  ensureStack().append(node);
  setTimeout(() => node.remove(), timeout);
  return node;
}
