import {defineConfig} from '@playwright/test';
import base from './playwright.config';
export default defineConfig({...base,projects:[{name:'webkit',use:{browserName:'webkit',hasTouch:true,isMobile:true}}]});
