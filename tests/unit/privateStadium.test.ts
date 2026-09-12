import { expect, it } from 'vitest';
import { stadiumProgress } from '../../src/components/PrivateSprintStadium';
it('anchors every distance at a fixed start and finish without invalid telemetry escaping the course',()=>{
  expect(stadiumProgress(0,100)).toBe(0);
  expect(stadiumProgress(50,100)).toBe(.5);
  expect(stadiumProgress(100,100)).toBe(1);
  expect(stadiumProgress(200,100)).toBe(1);
  expect(stadiumProgress(-1,100)).toBe(0);
  expect(stadiumProgress(NaN,100)).toBe(0);
  expect(stadiumProgress(1,0)).toBe(0);
});

import { canUsePrivateStadium } from '../../src/lib/privateStadiumAccess';
it('limits the stadium experiment to the signed-in owner outside shared-device and regular-user modes',()=>{
  const owner={admin:true,email:'preskiranch@gmail.com'};
  expect(canUsePrivateStadium(owner,false,false)).toBe(true);
  expect(canUsePrivateStadium(null,false,false)).toBe(false);
  expect(canUsePrivateStadium({...owner,admin:false},false,false)).toBe(false);
  expect(canUsePrivateStadium({...owner,email:'another-admin@example.com'},false,false)).toBe(false);
  expect(canUsePrivateStadium(owner,true,false)).toBe(false);
  expect(canUsePrivateStadium(owner,false,true)).toBe(false);
  expect(canUsePrivateStadium({...owner,managedChild:true},false,false)).toBe(false);
});

import { stadiumCadence } from '../../src/lib/privateStadiumMath';
it('keeps invalid cadence samples out of the skeleton animation',()=>{
  expect(stadiumCadence(undefined)).toBe(0);
  expect(stadiumCadence(NaN)).toBe(0);
  expect(stadiumCadence(Infinity)).toBe(0);
  expect(stadiumCadence(-20)).toBe(0);
  expect(stadiumCadence(90)).toBe(90);
  expect(stadiumCadence(9000)).toBe(300);
});
