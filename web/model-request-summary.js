// Keep the actual model request inspectable without retaining auth headers or endpoints.
export function modelRequestSummary(body){
 const summary={};
 for(const key of ['model','messages','input','system','instructions','max_tokens','max_output_tokens','temperature','stream','response_format','reasoning_effort','custom_include_body'])
  if(body[key]!==undefined)summary[key]=body[key];
 return structuredClone(summary);
}
