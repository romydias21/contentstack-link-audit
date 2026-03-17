class TaskQueue {
  constructor(concurrency) {
    this.concurrency = Math.max(1, Number(concurrency) || 1);
    this.running = 0;
    this.queue = [];
    this.idleResolvers = [];
  }

  add(taskFn) {
    return new Promise((resolve, reject) => {
      this.queue.push({ taskFn, resolve, reject });
      this._next();
    });
  }

  _next() {
    if (this.running >= this.concurrency) return;
    const item = this.queue.shift();
    if (!item) return;

    this.running += 1;
    Promise.resolve()
      .then(item.taskFn)
      .then((result) => {
        this.running -= 1;
        item.resolve(result);
        this._next();
        this._checkIdle();
      })
      .catch((err) => {
        this.running -= 1;
        item.reject(err);
        this._next();
        this._checkIdle();
      });
  }

  _checkIdle() {
    if (this.running !== 0 || this.queue.length !== 0) return;
    const resolvers = this.idleResolvers.slice();
    this.idleResolvers.length = 0;
    resolvers.forEach((resolve) => resolve());
  }

  onIdle() {
    if (this.running === 0 && this.queue.length === 0) {
      return Promise.resolve();
    }
    return new Promise((resolve) => {
      this.idleResolvers.push(resolve);
    });
  }

  size() {
    return {
      running: this.running,
      pending: this.queue.length
    };
  }
}

module.exports = { TaskQueue };
