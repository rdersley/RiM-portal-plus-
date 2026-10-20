import {adfToText} from './self-service-runtime.js';

// Short text excerpts for the customer CSV/Excel export, so a row says what the
// request is about without exporting the whole description or comment thread.
// Built on the server: raw comments include internal notes and must never reach
// the browser.
export const EXCERPT_FIELDS=['description','comment'];
export const EXCERPT_LENGTH=300;

function plain(value){if(value==null)return'';const text=typeof value==='object'?adfToText(value):String(value);return text.replace(/\s+/g,' ').trim();}

export function excerpt(value,max=EXCERPT_LENGTH){const text=plain(value);if(text.length<=max)return text;const cut=text.slice(0,max),space=cut.lastIndexOf(' ');return`${(space>max*0.6?cut.slice(0,space):cut).trimEnd()}…`;}

// Only comments Jira marks as shared with the customer. Fails closed: a comment
// without jsdPublic === true is treated as internal.
export function latestPublicComment(commentField){const comments=Array.isArray(commentField?.comments)?commentField.comments:[];const shared=comments.filter(c=>c?.jsdPublic===true&&plain(c.body));if(!shared.length)return{text:'',created:''};const last=shared.reduce((a,b)=>String(b.created||'')>=String(a.created||'')?b:a);return{text:excerpt(last.body),created:String(last.created||'')};}

export function exportExcerpts(fields={}){const comment=latestPublicComment(fields.comment);return{description:excerpt(fields.description),latestPublicComment:comment.text,latestPublicCommentDate:comment.created};}
