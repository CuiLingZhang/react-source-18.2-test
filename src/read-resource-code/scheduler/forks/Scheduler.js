// import {
//   IdlePriority,
//   ImmediatePriority, LowPriority, NormalPriority,
//   UserBlockingPriority
// } from "../../../react/packages/scheduler/src/SchedulerPriorities";
// import {
//   continuousYieldMs,
//   enableIsInputPending, enableIsInputPendingContinuous,
//   enableProfiling,
//   enableSchedulerDebugging, frameYieldMs, maxYieldMs
// } from "../../../react/packages/scheduler/src/SchedulerFeatureFlags";
import { peek, pop, push } from "../../../react/packages/scheduler/src/SchedulerMinHeap";
import {
  markSchedulerSuspended,
  markSchedulerUnsuspended, markTaskCompleted,
  markTaskErrored, markTaskRun,
  markTaskStart, markTaskYield
} from "../../../react/packages/scheduler/src/SchedulerProfiling";

// 任务优先级级别
export const NoPriority = 0;
export const ImmediatePriority = 1;
export const UserBlockingPriority = 2;
export const NormalPriority = 3;
export const LowPriority = 4;
export const IdlePriority = 5;

// Tasks are stored on a min heap
var taskQueue = [];   // 普通任务队列
var timerQueue = [];  // 延时任务队列

var currentTask = null;
var currentPriorityLevel = NormalPriority;

// This is set while performing work, to prevent re-entrance.
var isPerformingWork = false;

var isHostCallbackScheduled = false;
var isHostTimeoutScheduled = false;

let isMessageLoopRunning = false;
let scheduledHostCallback = null; // 调度的任务
let startTime = -1;

let needsPaint = false; // TODO：是否需要重绘？

// Incrementing id counter. Used to maintain insertion order.
var taskIdCounter = 1;

// 任务超时时间
// Max 31 bit integer. The max integer size in V8 for 32-bit systems.
// Math.pow(2, 30) - 1
// 0b111111111111111111111111111111
var maxSigned31BitInt = 1073741823;
// Times out immediately
var IMMEDIATE_PRIORITY_TIMEOUT = -1;
// Eventually times out
var USER_BLOCKING_PRIORITY_TIMEOUT = 250;
var NORMAL_PRIORITY_TIMEOUT = 5000;
var LOW_PRIORITY_TIMEOUT = 10000;
// Never times out
var IDLE_PRIORITY_TIMEOUT = maxSigned31BitInt;

export const enableSchedulerDebugging = false;

// Pausing the scheduler is useful for debugging.
var isSchedulerPaused = false;

export const frameYieldMs = 5;
export const continuousYieldMs = 50;
export const maxYieldMs = 300;
export const enableIsInputPending = false;
export const enableIsInputPendingContinuous = false;
export const enableProfiling = false;
// Scheduler periodically yields in case there is other work on the main
// thread, like user events. By default, it yields multiple times per frame.
// It does not attempt to align with frame boundaries, since most tasks don't
// need to be frame aligned; for those that do, use requestAnimationFrame.
let frameInterval = frameYieldMs;
const continuousInputInterval = continuousYieldMs;
const maxInterval = maxYieldMs;
const isInputPending =
  typeof navigator !== 'undefined' &&
  navigator.scheduling !== undefined &&
  navigator.scheduling.isInputPending !== undefined
    ? navigator.scheduling.isInputPending.bind(navigator.scheduling)
    : null;
const continuousOptions = {includeContinuous: enableIsInputPendingContinuous};

// 获取当前时间
let getCurrentTime;
const hasPerformanceNow =
  typeof performance === 'object' && typeof performance.now === 'function';
if (hasPerformanceNow) {
  const localPerformance = performance;
  getCurrentTime = () => localPerformance.now();
} else {
  const localDate = Date;
  const initialTime = localDate.now();
  getCurrentTime = () => localDate.now() - initialTime;
}

// 取消一个已存在的timeout
let taskTimeoutID = -1;
const localClearTimeout =
  typeof clearTimeout === 'function' ? clearTimeout : null;
function cancelHostTimeout() {
  localClearTimeout(taskTimeoutID);
  taskTimeoutID = -1;
}

/**
 *
 * @param priorityLevel 优先级
 * @param callback 具体的任务
 * @param options { delay: xxx } 是一个对象，这里只使用了属性 delay(延迟时间)
 * @returns {{priorityLevel, sortIndex: number, expirationTime: *, callback, startTime, id: number}}
 */
function unstable_scheduleCallback(priorityLevel, callback, options) {
  // 获取当前时间
  var currentTime = getCurrentTime();

  // 计算任务的开始时间
  var startTime;
  if (typeof options === 'object' && options !== null) {
    var delay = options.delay;
    if (typeof delay === 'number' && delay > 0) {
      // 加上延时时间
      startTime = currentTime + delay;
    } else {
      startTime = currentTime;
    }
  } else {
    startTime = currentTime;
  }

  // 根据任务优先级设置任务超时时间
  var timeout;
  switch (priorityLevel) {
    case ImmediatePriority:
      timeout = IMMEDIATE_PRIORITY_TIMEOUT;
      break;
    case UserBlockingPriority:
      timeout = USER_BLOCKING_PRIORITY_TIMEOUT;
      break;
    case IdlePriority:
      timeout = IDLE_PRIORITY_TIMEOUT;
      break;
    case LowPriority:
      timeout = LOW_PRIORITY_TIMEOUT;
      break;
    case NormalPriority:
    default:
      timeout = NORMAL_PRIORITY_TIMEOUT;
      break;
  }

  // 过期时间
  // 优先级为ImmediatePriority立即执行的任务的过期时间计算出来会比当前时间早
  var expirationTime = startTime + timeout;

  var newTask = {
    id: taskIdCounter++,  // 任务id
    callback,             // 具体任务执行的函数
    priorityLevel,        // 优先级
    startTime,            // 任务开始时间
    expirationTime,       // 任务过期时间
    sortIndex: -1,        // TODO
  };
  // enableProfiling: 资料收集启用的配置
  if (enableProfiling) {
    newTask.isQueued = false;
  }

  if (startTime > currentTime) {
    // 延时任务
    // This is a delayed task.
    newTask.sortIndex = startTime;
    // 将该任务推入到延时任务队列中
    push(timerQueue, newTask);
    if (peek(taskQueue) === null && newTask === peek(timerQueue)) {
      // taskQueue 里的任务都执行完毕了，timerQueue 中取出的最新任务就是当前任务
      // All tasks are delayed, and this is the task with the earliest delay.
      // isHostTimeoutScheduled: 是否有正在调度的timeoutScheduler
      if (isHostTimeoutScheduled) {
        // Cancel an existing timeout.
        cancelHostTimeout();
      } else {
        isHostTimeoutScheduled = true;
      }
      // 如果是延时任务就调用 requestHostTimeout 进行任务的调度
      // Schedule a timeout.
      requestHostTimeout(handleTimeout, startTime - currentTime);
    }
  } else {
    // 普通任务
    newTask.sortIndex = expirationTime;
    // 将该任务推入到普通任务队列中
    push(taskQueue, newTask);
    if (enableProfiling) {
      markTaskStart(newTask, currentTime);
      newTask.isQueued = true;
    }
    // Schedule a host callback, if needed. If we're already performing work,
    // wait until the next time we yield.
    // isHostCallbackScheduled: 是否有正在调度的callbackScheduler
    // isPerformingWork: 是否有工作正在执行
    if (!isHostCallbackScheduled && !isPerformingWork) {
      isHostCallbackScheduled = true;
      // 如果是普通任务就调用 requestHostCallback 进行任务的调度
      requestHostCallback(flushWork);
    }
  }

  // 向外部返回任务
  return newTask;
}

// Capture local references to native APIs, in case a polyfill overrides them.
const localSetTimeout = typeof setTimeout === 'function' ? setTimeout : null;
const localSetImmediate =
  typeof setImmediate !== 'undefined' ? setImmediate : null; // IE and Node.js + jsdom

/**
 * 调用 scheduledHostCallback，也就是传入的 flushWork
 */
const performWorkUntilDeadline = () => {
  // scheduledHostCallback: 调用时传入的flushWork
  if (scheduledHostCallback !== null) {
    // 获取当前时间
    const currentTime = getCurrentTime();
    // 测量任务的执行时间，从而知道主线程被阻塞多久
    // Keep track of the start time so we can measure how long the main thread
    // has been blocked.
    startTime = currentTime;
    // 默认还有剩余时间
    const hasTimeRemaining = true;

    // If a scheduler task throws, exit the current browser task so the
    // error can be observed.
    //
    // Intentionally not using a try-catch, since that makes some debugging
    // techniques harder. Instead, if `scheduledHostCallback` errors, then
    // `hasMoreWork` will remain true, and we'll continue the work loop.
    // 默认还有需要做的任务，scheduledHostCallback 报错时可以继续工作循环
    let hasMoreWork = true;
    try {
      // flushWork(true, 开始时间)
      // 返回值为true则代表还有工作没做完，否则表示没有任务了
      hasMoreWork = scheduledHostCallback(hasTimeRemaining, currentTime);
    } finally {
      if (hasMoreWork) {
        // If there's more work, schedule the next message event at the end
        // of the preceding one.
        // 继续调度，继续包装任务将任务放入消息队列
        schedulePerformWorkUntilDeadline();
      } else {
        isMessageLoopRunning = false;
        scheduledHostCallback = null;
      }
    }
  } else {
    isMessageLoopRunning = false;
  }
  // Yielding to the browser will give it a chance to paint, so we can
  // reset this.
  needsPaint = false;
};

// 不同环境采用不同的任务生成方式。最后都调用 performWorkUntilDeadlineform
let schedulePerformWorkUntilDeadline;
if (typeof localSetImmediate === 'function') {
  // Node.js and old IE.
  // There's a few reasons for why we prefer setImmediate.
  //
  // Unlike MessageChannel, it doesn't prevent a Node.js process from exiting.
  // (Even though this is a DOM fork of the Scheduler, you could get here
  // with a mix of Node.js 15+, which has a MessageChannel, and jsdom.)
  // https://github.com/facebook/react/issues/20756
  //
  // But also, it runs earlier which is the semantic we want.
  // If other browsers ever implement it, it's better to use it.
  // Although both of these would be inferior to native scheduling.
  schedulePerformWorkUntilDeadline = () => {
    localSetImmediate(performWorkUntilDeadline);
  };
} else if (typeof MessageChannel !== 'undefined') {
  // DOM and Worker environments.
  // We prefer MessageChannel because of the 4ms setTimeout clamping.
  const channel = new MessageChannel();
  const port = channel.port2;
  channel.port1.onmessage = performWorkUntilDeadline;
  schedulePerformWorkUntilDeadline = () => {
    port.postMessage(null);
  };
} else {
  // We should only fallback here in non-browser environments.
  schedulePerformWorkUntilDeadline = () => {
    localSetTimeout(performWorkUntilDeadline, 0);
  };
}

/**
 * 调度普通任务：实际没有做什么事情，主要是调用 schedulePerformWorkUntilDeadline
 * @param callback 调用时传入的flushWork
 */
function requestHostCallback(callback) {
  // scheduledHostCallback: 调用时传入的flushWork
  scheduledHostCallback = callback;
  if (!isMessageLoopRunning) { // 消息循环
    isMessageLoopRunning = true;
    schedulePerformWorkUntilDeadline();
  }
}

/**
 * 核心就是调用 workLoop
 * @param hasTimeRemaining 是否有剩余时间，一开始是true
 * @param initialTime 做该任务的开始执行时间
 * @returns {*}
 */
function flushWork(hasTimeRemaining, initialTime) {
  if (enableProfiling) {
    markSchedulerUnsuspended(initialTime);
  }

  // We'll need a host callback the next time work is scheduled.
  isHostCallbackScheduled = false;
  if (isHostTimeoutScheduled) {
    // We scheduled a timeout but it's no longer needed. Cancel it.
    isHostTimeoutScheduled = false;
    cancelHostTimeout();
  }

  isPerformingWork = true;
  // currentPriorityLevel 会在下面 workLoop 里设置为当前任务的优先级
  const previousPriorityLevel = currentPriorityLevel;
  try {
    if (enableProfiling) {
      try {
        return workLoop(hasTimeRemaining, initialTime);
      } catch (error) {
        if (currentTask !== null) {
          const currentTime = getCurrentTime();
          markTaskErrored(currentTask, currentTime);
          currentTask.isQueued = false;
        }
        throw error;
      }
    } else {
      // No catch in prod code path.
      return workLoop(hasTimeRemaining, initialTime);
    }
  } finally {
    currentTask = null;
    currentPriorityLevel = previousPriorityLevel;
    isPerformingWork = false;
    if (enableProfiling) {
      const currentTime = getCurrentTime();
      markSchedulerSuspended(currentTime);
    }
  }
}

/**
 * 执行任务的实际内容函数
 * @param hasTimeRemaining 是否有剩余时间，一开始是true
 * @param initialTime 做该任务的开始执行时间
 * @returns {boolean}
 */
function workLoop(hasTimeRemaining, initialTime) {
  let currentTime = initialTime;
  // 获取延时任务队列中不再延时的任务放到普通任务队列中
  advanceTimers(currentTime);
  // 从普通任务队列中取出一个任务
  currentTask = peek(taskQueue);
  while (
    currentTask !== null &&
    !(enableSchedulerDebugging && isSchedulerPaused)
    ) {
    if (
      currentTask.expirationTime > currentTime &&
      (!hasTimeRemaining || shouldYieldToHost())
    ) {
      // 任务还没过期 && (没有剩余时间 || 任务需要暂停，归还主线程控制权给浏览器)
      // This currentTask hasn't expired, and we've reached the deadline.
      break;
    }
    const callback = currentTask.callback;
    if (typeof callback === 'function') {
      currentTask.callback = null;
      currentPriorityLevel = currentTask.priorityLevel;
      const didUserCallbackTimeout = currentTask.expirationTime <= currentTime;
      if (enableProfiling) {
        markTaskRun(currentTask, currentTime);
      }
      // 执行任务，并且如果任务返回的还是一个任务，就继续 advanceTimers 处理
      const continuationCallback = callback(didUserCallbackTimeout);
      currentTime = getCurrentTime();
      if (typeof continuationCallback === 'function') {
        // 如果任务返回了一个函数，就将这个返回的函数赋值给 currentTask.callback，然后继续 while 循环执行该callback
        currentTask.callback = continuationCallback;
        if (enableProfiling) {
          markTaskYield(currentTask, currentTime);
        }
      } else {
        if (enableProfiling) {
          markTaskCompleted(currentTask, currentTime);
          currentTask.isQueued = false;
        }
        // 如果任务没有返回一个函数，并且从普通任务队列取出的任务还是当前的任务，就弹出
        // TODO: 什么情况下 currentTask 和 peek(taskQueue) 不相等？猜测是中间插入的优先级更高的任务，导致 taskQueue 中的第一个任务不是当前已执行的这个任务了
        if (currentTask === peek(taskQueue)) {
          pop(taskQueue);
        }
      }
      advanceTimers(currentTime);
    } else {
      // 任务的执行内容不是函数就直接弹出该任务
      pop(taskQueue);
    }
    // 取出下一个任务，继续 while 循环
    currentTask = peek(taskQueue);
  }

  // 是否还有任务没有执行完
  // performWorkUntilDeadline 中的 hasMoreWork 就拿到了这个值可以进行判断
  // Return whether there's additional work
  if (currentTask !== null) {
    return true;
  } else {
    // 如果普通任务都执行完了，则去处理延时任务
    const firstTimer = peek(timerQueue);
    if (firstTimer !== null) {
      requestHostTimeout(handleTimeout, firstTimer.startTime - currentTime);
    }
    return false;
  }
}

/**
 * 判断是否需要归还给对主线程的控制给浏览器
 * @returns {*|boolean}
 */
function shouldYieldToHost() {
  // 任务执行的时间
  const timeElapsed = getCurrentTime() - startTime;
  if (timeElapsed < frameInterval) {
    // 主线程只被阻塞了很短的时间，这里默认设置了5ms
    // The main thread has only been blocked for a really short amount of time;
    // smaller than a single frame. Don't yield yet.
    return false;
  }

  // 主线程阻塞了一段不可忽略的时间
  // The main thread has been blocked for a non-negligible amount of time. We
  // may want to yield control of the main thread, so the browser can perform
  // high priority tasks. The main ones are painting and user input. If there's
  // a pending paint or a pending input, then we should yield. But if there's
  // neither, then we can yield less often while remaining responsive. We'll
  // eventually yield regardless, since there could be a pending paint that
  // wasn't accompanied by a call to `requestPaint`, or other main thread tasks
  // like network events.
  if (enableIsInputPending) {
    if (needsPaint) {
      // There's a pending paint (signaled by `requestPaint`). Yield now.
      return true;
    }
    if (timeElapsed < continuousInputInterval) {
      // We haven't blocked the thread for that long. Only yield if there's a
      // pending discrete input (e.g. click). It's OK if there's pending
      // continuous input (e.g. mouseover).
      if (isInputPending !== null) {
        return isInputPending();
      }
    } else if (timeElapsed < maxInterval) {
      // Yield if there's either a pending discrete or continuous input.
      if (isInputPending !== null) {
        return isInputPending(continuousOptions);
      }
    } else {
      // We've blocked the thread for a long time. Even if there's no pending
      // input, there may be some other scheduled work that we don't know about,
      // like a network event. Yield now.
      return true;
    }
  }

  // `isInputPending` isn't available. Yield now.
  return true;
}

/**
 * 获取延时任务队列中不再延时的任务放到普通任务队列中
 * @param currentTime
 */
function advanceTimers(currentTime) {
  // Check for tasks that are no longer delayed and add them to the queue.
  let timer = peek(timerQueue);
  // 遍历整个延时任务队列
  while (timer !== null) {
    if (timer.callback === null) {
      // Timer was cancelled.
      pop(timerQueue);
    } else if (timer.startTime <= currentTime) {
      // Timer fired. Transfer to the task queue.
      // 如果延时任务不再延时，就将其转移到普通任务队列中去
      pop(timerQueue);
      timer.sortIndex = timer.expirationTime;
      push(taskQueue, timer);
      if (enableProfiling) {
        markTaskStart(timer, currentTime);
        timer.isQueued = true;
      }
    } else {
      // Remaining timers are pending.
      return;
    }
    timer = peek(timerQueue);
  }
}


/**
 * 调度延时任务：主要就是设置 setTimeout，并且在 setTimeout 中调用传入的 handleTimeout
 * @param callback 传入的 handleTimeout
 * @param ms 延时时间
 */
function requestHostTimeout(callback, ms) {
  taskTimeoutID = localSetTimeout(() => {
    callback(getCurrentTime());
  }, ms);
}

/**
 * 将到时间的延时任务放入普通任务队列
 * 执行普通任务
 * 从延时任务队列取出任务设置 setTimeout
 * @param currentTime 当前时间
 */
function handleTimeout(currentTime) {
  isHostTimeoutScheduled = false;
  // 从 timerQueue 中取出到时间的任务放入到 taskQueue
  advanceTimers(currentTime);

  if (!isHostCallbackScheduled) {
    if (peek(taskQueue) !== null) {
      isHostCallbackScheduled = true;
      // 如果此刻没有其它正在调度的普通任务，并且普通任务队列中还有任务，就执行普通任务
      requestHostCallback(flushWork);
    } else {
      const firstTimer = peek(timerQueue);
      if (firstTimer !== null) {
        // 从延时任务队列中取出任务设置 setTimeout
        requestHostTimeout(handleTimeout, firstTimer.startTime - currentTime);
      }
    }
  }
}

export {
  ImmediatePriority as unstable_ImmediatePriority,
  UserBlockingPriority as unstable_UserBlockingPriority,
  NormalPriority as unstable_NormalPriority,
  IdlePriority as unstable_IdlePriority,
  LowPriority as unstable_LowPriority,
  // unstable_runWithPriority,
  // unstable_next,
  unstable_scheduleCallback,
  // unstable_cancelCallback,
  // unstable_wrapCallback,
  // unstable_getCurrentPriorityLevel,
  shouldYieldToHost as unstable_shouldYield,
  // unstable_requestPaint,
  // unstable_continueExecution,
  // unstable_pauseExecution,
  // unstable_getFirstCallbackNode,
  getCurrentTime as unstable_now,
  // forceFrameRate as unstable_forceFrameRate,
};
