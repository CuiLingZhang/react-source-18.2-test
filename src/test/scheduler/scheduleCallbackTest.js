import * as Scheduler from '../../read-resource-code/scheduler';
const { unstable_scheduleCallback: scheduleCallback } = Scheduler;

const ordinaryTask1 = () => {
  console.log('ordinaryTask1 executed');
};

const delayedTask1 = () => {
  console.log('delayedTask1 executed');
};

scheduleCallback(null, ordinaryTask1, {});
scheduleCallback(null, delayedTask1, { delay: 3000 });
