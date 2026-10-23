// 人工修订只存基础档案与修改记录；原出版资料仍只读。
export const EDITABLE_SETTING_KEYS = Object.freeze(['powerScale','dims','刻度','rules','society','techOrMagic','historyNotes','situation']);
const text={kind:'string',minLength:1};
export const sourceProfileValueSchema={kind:'object',additional:false,required:['name','aliases','fields'],props:{
 name:text,aliases:{kind:'array',items:text},fields:{kind:'strRecord'}
}};
export const sourceEditsSchema={kind:'object',additional:false,required:['version','entities','settingKeys'],props:{
 version:{kind:'number',int:true,min:1,max:1},
 entities:{kind:'array',items:{kind:'object',additional:false,required:['id','value'],props:{id:text,value:sourceProfileValueSchema}}},
 originals:{kind:'array',items:{kind:'object',additional:false,required:['id','value'],props:{id:text,value:sourceProfileValueSchema}}},
 settingKeys:{kind:'array',items:{kind:'string',enum:EDITABLE_SETTING_KEYS}},
 last:{kind:'object',additional:false,required:['id','kind','target','before','after','wasOverridden'],props:{
  id:text,kind:{kind:'string',enum:['entity','setting']},target:text,before:{kind:'any'},after:{kind:'any'},wasOverridden:{kind:'boolean'},
  beforeRuleKinds:{kind:'strRecord'},afterRuleKinds:{kind:'strRecord'},beforeSetting:{kind:'any'},afterSetting:{kind:'any'}
 }}
}};
