import {test,expect} from '@playwright/test';

for(const owner of [true,false])test(`stadium is ${owner?'available to its owner':'hidden from other administrators'} in the real app`,async({page})=>{
  const trackId = 'custom-camera-distance-sprint';
  const customTrack = {
    id: trackId,
    name: 'Drag Strip',
    country: 'Custom Routes',
    countryCode: 'CUSTOM',
    state: 'New Hampshire',
    region: 'New Hampshire',
    source: 'Custom',
    sourceUrl: 'local://custom-route',
    address: 'Epping, NH, USA',
    latitude: 43.03,
    longitude: -71.08,
    lengthMeters: 500,
    elevationMeters: 0,
    surface: 'Custom sprint route',
    outline: [
      { lat: 43.03, lng: -71.08 },
      { lat: 43.035, lng: -71.08 },
    ],
    routeStatus: 'user-mapped',
    zones: [],
    leaderboards: { rpm: [], speed: [] },
  };
  const mapping = {
    version:1,savedAt:'2026-09-12T00:00:00.000Z',routeStatus:'user-mapped',restAfterSeconds:1,zoneBoundaryMeters:[],zoneBoundarySets:[],zones:[],splitSections:[],
    trackId,
    trackName: customTrack.name,
    country: customTrack.country,
    state: customTrack.state,
    lengthMeters: 500,
    centerline: [
      { lat: 43.03, lng: -71.08 },
      { lat: 43.035, lng: -71.08 },
    ],
    startGate: { lat: 43.03, lng: -71.08 },
    finishLine: { lat: 43.035, lng: -71.08 },
  };

  await page.addInitScript(({customTrack,mapping})=>{localStorage.setItem('tracklab-bmx-custom-routes-v1',JSON.stringify([customTrack]));localStorage.setItem('tracklab:user-track-mappings:v1',JSON.stringify({[customTrack.id]:mapping}));},{customTrack,mapping});
  await page.route('**/api/auth/me',route=>route.fulfill({json:{user:{id:'stadium-test',profileKey:'user:stadium-test',email:owner?'preskiranch@gmail.com':'other@example.com',name:'Stadium Tester',admin:true,membership:{tier:'racer',bikeSeats:4,updatedAt:Date.now()}}}}));
  await page.route('**/api/user-data*',route=>route.fulfill({json:{trackMappings:{[trackId]:mapping},customRoutes:[customTrack],bikeProfiles:[],studioRiders:[],accountProfile:{updatedAt:Date.now()}}}));
  await page.route('**/api/club-connect*',route=>route.fulfill({json:{canManageClub:true,ownedClub:null,memberships:[]}}));
  await page.route('**/api/training-sessions*',route=>route.fulfill({json:{sessions:[],totals:{}}}));
  await page.route('https://maps.googleapis.com/**',route=>route.abort());
  await page.goto(`/?track=${trackId}`);
  const open=page.getByRole('button',{name:'Open App'});
  await open.or(page.getByRole('navigation',{name:'Primary'})).first().waitFor({state:'visible'});
  if(await open.isVisible())await open.click();
  await page.getByRole('button',{name:'Straight Sprint',exact:true}).click();
  await expect(page.getByLabel('Drag Strip Game Arena',{exact:true})).toBeVisible();
  const toggle=page.getByRole('button',{name:'Try private stadium'});
  if(!owner){await expect(toggle).toHaveCount(0);return;}
  await toggle.click();
  await expect(page.getByLabel('Private Sprint Stadium',{exact:true})).toBeVisible();
  await page.waitForSelector('canvas[data-painted="true"]');
  await page.getByRole('button',{name:'Stadium test on · use original'}).click();
  await expect(page.getByLabel('Drag Strip Game Arena',{exact:true})).toBeVisible();
  await expect(page.getByLabel('Private Sprint Stadium',{exact:true})).toHaveCount(0);
});
