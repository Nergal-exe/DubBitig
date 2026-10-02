import {spawnSync} from 'node:child_process';
// All-user installation defaults to Program Files and requests elevation.
const options=[];
const result=spawnSync(process.execPath,['node_modules/electron-builder/cli.js','--win','nsis',...options],{stdio:'inherit'});
if(result.error)throw result.error;process.exit(result.status ?? 1);
