import React from 'react';
import { createRoot } from 'react-dom/client';
import { TrainingResultsSpreadsheet } from '../../../src/components/TrainingResultsSpreadsheet';
import '../../../src/styles.css';
import '../../../src/components/AccountProfileView.css';
import type { TrainingSession } from '../../../src/types';
const sessions: TrainingSession[] = Array.from({length:20}, (_,i)=>({id:`session-${i}`,activityType:'straight-sprint',title:`Sprint ${i+1}`,startedAt:1750000000000+i*10000,endedAt:1750000008000+i*10000,durationMs:8000,distanceMeters:100,source:'live',createdAt:1750000000000,updatedAt:1750000000000,details:{summaries:[{playerId:1,riderName:'Rasheen The Machine Hicks',riderId:'test-rider',finishTimeMs:8000,topWatts:700,averageWatts:500,rank:1}]}}));
createRoot(document.getElementById('root')!).render(<div className="platform-shell"><aside>Navigation</aside><main className="platform-main"><div className="account-profile-view"><div className="account-training-layout"><section className="training-calendar">Calendar</section><TrainingResultsSpreadsheet fullWidth sessions={sessions} dateLabel="Test day" speedUnit="mph" distanceUnit="feet"/></div></div></main><div id="training-results-outlet"/></div>);
