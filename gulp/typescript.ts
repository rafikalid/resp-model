/**
 * Compile Typescript files
 */
 import Gulp from 'gulp';
 import GulpTypescript from 'gulp-typescript';
 import SrcMap from 'gulp-sourcemaps';
 import CreateImportTransformer from './typescript-transformer.js';
 import JSON5 from 'json5';
 import {readFileSync} from 'fs';
 
 const {src, dest, lastRun}= Gulp;
 const {parse}= JSON5;
 
 // import {transform} from 'ts-transform-import-path-rewrite'
 
 //Load config
 const tsConfig= parse(readFileSync('tsconfig.json', 'utf-8'));
 const importTransformer= CreateImportTransformer(tsConfig.compilerOptions);
 
 const isProd= process.argv.includes('--prod');
 
 const TsProject = GulpTypescript.createProject('tsconfig.json', {
	 removeComments: isProd,
	 pretty: !isProd,
	 getCustomTransformers: ()=>({
		 after: [
			 importTransformer
		 ]
	 })
 });
 
 // import babel from 'gulp-babel';
 
 export function typescriptCompile(){
	 return src('src/**/*.ts', {nodir: true, since: lastRun(typescriptCompile)})
		 .pipe(SrcMap.init())
		 .pipe(TsProject())
		 .pipe(SrcMap.write('.'))
		 .pipe(dest('dist'));
 }