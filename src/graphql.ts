import { GraphQLInputObjectType, GraphQLObjectType, GraphQLInputFieldConfigMap, GraphQLFieldConfigMap, GraphQLOutputType, GraphQLInputType, GraphQLString, GraphQLFloat, GraphQLBoolean, GraphQLScalarType, GraphQLEnumType, GraphQLList, GraphQLNonNull, GraphQLFieldConfigArgumentMap, GraphQLFieldResolver, GraphQLInputFieldMap, GraphQLSchema, GraphQLUnionType, GraphQLArgumentConfig, GraphQLEnumValueConfigMap } from "graphql";
import { ClassType, FieldSchema, FieldTypes, ObjectType, FieldListDescriptor, FieldRefDescriptor, EntityDescriptor } from "./schema";
import { fieldSymb } from "./symbols";
import { Union } from "./union";


/** Is output or input object */
enum ObjectInOut{
	/** Output object */
	OUTPUT,
	/** Input object */
	INPUT,
	/** Input root object as argument for resolver and subscription */
	ARG
};
/** add node name postfix */
function _nodeNamePostfix(name: string, type: ObjectInOut): string{
	switch(type){
		case ObjectInOut.INPUT:
			name+= 'Input';
			break;
		case ObjectInOut.ARG:
			name+= '_Arg';
			break;
	}
	return name;
}
/** Map objects with data info */
interface MappedObjInfo{
	type:	ObjectInOut
	fields:	GraphQLFieldConfigMap<any, any>|GraphQLInputFieldConfigMap
	gql?:	GraphQLObjectType|GraphQLInputObjectType
}
/** Wrappers */
enum WrappedQueueWrappers{ LIST, NON_NULL }

interface FoundEnitiesPrepare{
	// Store found entities
	entities: 	any[]
	/** If initialized for OUTPUT, INPUT and ARG */
	ok: boolean[]
}

/** Compile schema */
export function compileGqlSchema(args: Record<string, ObjectType>[]){
	// Object resolving queue
	const queue: ObjectType[]= [];
	const queueN: string[]= [];
	const queueT: ObjectInOut[]= [];
	//* Prepare and merge public classes
	const foundEntitiesSet: Set<any>= new Set();
	const mappedClasses: Map<string, FoundEnitiesPrepare>= new Map();
	//! Append entity to the list, used only in preparation phase once in code.
	function _addEntity(name: string, entity:any){
		// get entity descriptor
		if(typeof entity=== 'function'){
			var entityD= (entity as ClassType)[fieldSymb]!
			if(entityD==null) throw new Error(`Missing fields on entity: ${entity.name}`);
			// name= typeof entityD.name === 'string'? entityD.name : entity.name;
			name= entity.name;
		}
		var entityDesc: FoundEnitiesPrepare= mappedClasses.get(name)!;
		if(entityDesc== null){
			entityDesc= {
				entities: [],
				ok: [false, false, false]
			};
			mappedClasses.set(name, entityDesc);
		}
		entityDesc.entities.push(entity);
	}
	// Add Objects
	var i: number, len: number, arg:Record<string, ObjectType>, argObj: ObjectType;
	for(i=0, len= args.length; i<len; ++i){
		arg= args[i];
		Reflect.ownKeys(arg).forEach(argK=>{
			if(
				typeof argK==='string'
				&& argK.charAt(0)!=='_'
			){
				argObj= arg[argK];
				if(
					typeof argObj === 'function'
					|| (typeof argObj === 'object' && !Array.isArray(argObj))
				){
					if(argK === 'Query' || argK==='Mutation'||argK==='Subscription'){
						queue.push(argObj);
						queueN.push(argK);
						queueT.push(ObjectInOut.OUTPUT);
					} else if(foundEntitiesSet.has(argObj)){}
					else {
						foundEntitiesSet.add(argObj);
						// Add to the queue
						_addEntity(argK, argObj);
					}
				}
			}
		});
	}

	// Reference all classes with mapped fields
	const refMap: Map<string, MappedObjInfo>= new Map();
	const foundEntities: Set<any>[]= [
		new Set(), // ObjectInOut.OUTPUT
		new Set(), // ObjectInOut.INPUT
		new Set() //  ObjectInOut.ARG
	];
	
	// Generate unique names for entities
	const uniqueNames: Map<string, number> = new Map();
	function _getUniqueName(name: string){
		var n= uniqueNames.get(name);
		if(n==null) n= 0;
		uniqueNames.set(name, n+1);
		name= `${name}_${n}`;
		return name;
	}
	// Generate reference for doc
	function _genRef(ref: any, fieldKey: string, nodeType: ObjectInOut): string{
		var refName:string;
		//Reference name
		var entityD: EntityDescriptor;
		if(typeof ref==='string') refName= ref;
		else if(typeof ref==='function'){
			entityD= (ref as ClassType)[fieldSymb]!;
			if(entityD==null)
				throw new Error(`Missing fields on entity: ${ref.name}`);
			// refName= typeof entityD.name=== 'string' ? entityD.name : ref.name;
			refName= ref.name;
		}
		else if(entityD= (ref as ClassType)[fieldSymb]!){
			refName= typeof entityD.name=== 'string'? entityD.name : fieldKey;
			// ARG should be unique when Map or Plain object
			if(nodeType === ObjectInOut.ARG)
				refName= _getUniqueName(refName);
		}
		else
			refName= _getUniqueName(fieldKey);
		// Check for unloaded entities
		var entitySet= foundEntities[nodeType];
		var entityDesc: FoundEnitiesPrepare|undefined= mappedClasses.get(refName);
		if(entityDesc!=null && !entityDesc.ok[nodeType]){
			// Add all prepareed entities
			entityDesc.ok[nodeType]= true;
			var refI, refLen, refEntity, refEnt= entityDesc.entities;
			for(refI=0, refLen= refEnt.length; refI<refLen; ++refI){
				refEntity= refEnt[refI];
				entitySet.add(refEntity);
				queue.push(refEntity);
				queueN.push(refName);
				queueT.push(nodeType);
				++len;
			}
		}
		//Add to queue
		if(typeof ref !== 'string' && !entitySet.has(ref)){
			entitySet.add(ref);
			queue.push(ref);
			queueN.push(refName);
			queueT.push(nodeType);
			++len;
		}
		return refName;
	}
	// Get/create node
	function _getNode(nodeName: string, nodeType: ObjectInOut): MappedObjInfo{
		var nodeEl= refMap.get(nodeName)!;
		if(nodeEl==null){
			var nodeFields= {};
			if(nodeType=== ObjectInOut.OUTPUT){
				//* OUTPUT
				nodeEl= {
					type: nodeType,
					fields: nodeFields,
					gql: new GraphQLObjectType({
						fields: nodeFields as GraphQLFieldConfigMap<any, any>,
						name: nodeName,
						// description: '' //TODO
					})
				};
			} else if (nodeType === ObjectInOut.ARG) {
				// Argument
				nodeEl= {
					type: nodeType,
					fields: nodeFields
				};
			} else {
				//* INPUT
				nodeEl={
					type: nodeType,
					fields: nodeFields,
					gql: new GraphQLInputObjectType({
						fields: nodeFields as GraphQLInputFieldConfigMap ,
						name:	nodeName,
						// description: '' //TODO
					})
				}
			}
			refMap.set(nodeName, nodeEl);
		} else if(nodeEl.type !== nodeType){
			throw new Error(`Illegal type for: ${nodeName}`)
		}
		return nodeEl;
	}
	// Union resolver
	const _unionMap: Map<Union, GraphQLUnionType>= new Map();
	function _genUnion(union: Union):GraphQLUnionType{
		var result= _unionMap.get(union);
		if(result==null){
			// Resolve types
			var unionTypes= union._types;
			var unionGraphQlTypes: GraphQLObjectType[]= [];
			var unionResolver= union._resolver;
			var unionType, unionK;
			var refNode, targetFieldGql;
			for(unionK in unionTypes){
				unionType= unionTypes[unionK];
				//* Input or Output Object
				unionType= _genRef(unionType, 'unknown', ObjectInOut.OUTPUT);
				// Load reference
				refNode= _getNode(unionType, ObjectInOut.OUTPUT);
				targetFieldGql= refNode.gql;
				unionGraphQlTypes.push(targetFieldGql as GraphQLObjectType<any, any>);
			}
			// Create union
			result= new GraphQLUnionType({
				name:	union._name,
				types:	unionGraphQlTypes,
				description:	union._description,
				resolveType(value:any){
					return unionGraphQlTypes[unionResolver(value)];
				}
			});
			_unionMap.set(union, result);
		}
		return result;
	}
	// Compile
	i=0, len= queue.length;
	var currentNode: ObjectType, currentNodeName: string, currentNodeType: ObjectInOut;
	var it: IterableIterator<[string, FieldSchema]>;
	var node:		MappedObjInfo;
	var refNode:	MappedObjInfo;
	var fields:	GraphQLFieldConfigMap<any, any>|GraphQLInputFieldConfigMap|GraphQLFieldConfigArgumentMap;
	while(i<len){
		// Load current node
		currentNode= queue[i];
		currentNodeName= queueN[i];
		currentNodeType= queueT[i];
		if(currentNode== null)
			throw new Error(`Enexpected undefined value at: ${currentNodeName}`);
		var nextNodeType= currentNodeType===ObjectInOut.ARG? ObjectInOut.INPUT : currentNodeType;
		++i; // Next
		// Check 
		if(currentNodeName.endsWith('Input'))
			throw new Error(`Entity name could not ends with "Input" keyword: ${currentNodeName}`);
		if(currentNodeName.endsWith('_Arg'))
			throw new Error(`Entity name could not ends with "_Arg" keyword: ${currentNodeName}`);
		// get map iterator
		// var autoName= true;
		var entityDesc: EntityDescriptor;
		if(typeof currentNode === 'function') {
			if(!(entityDesc= (currentNode as ClassType)[fieldSymb]!))
				throw new Error(`Missing fields on entity: ${currentNodeName}`);
			it= entityDesc.fields.entries();
		}
		else if(currentNode instanceof Map)
			it= currentNode.entries();
		else if( entityDesc= (currentNode as {[fieldSymb]: EntityDescriptor})[fieldSymb]! ){
			it= entityDesc.fields.entries();
		} else if(currentNode instanceof Union){
			_genUnion(currentNode);
			continue;
		} else
			it= _objEntries(currentNode as Record<string, FieldSchema>);
		// Generate unique name
		// if(autoName)
		// 	currentNodeName= _getUniqueName(currentNodeName);
		// Add "Input" postfix
		currentNodeName= _nodeNamePostfix(currentNodeName, currentNodeType);
		// Get/Create Graphql object
		node= _getNode(currentNodeName, currentNodeType);
		fields= node.fields;
		// Go through fields
		while(true){
			// Get next entry
			var entry= it.next();
			if(entry.done) break;
			var [fieldKey, fieldValue]= entry.value;
			var fieldSchema= fieldValue._
			var rootFieldSchema= fieldSchema;
			// Check for duplicate fields
			if(Reflect.has(fields, fieldKey))
				throw new Error(`Duplicate field: ${currentNodeName}::${fieldKey}`);
			// Check for lists && requireds
			var wrappersQueue= []; // wrapped with list or nonNull
			while(true){
				// Add required wrapper
				if(fieldSchema.required) wrappersQueue.push(WrappedQueueWrappers.NON_NULL);
				if(fieldSchema.type===FieldTypes.LIST){
					wrappersQueue.push(WrappedQueueWrappers.LIST);
					fieldSchema= (fieldSchema as FieldListDescriptor).items
				} else {
					break;
				}
			}
			// Check the reference
			var targetFieldGql: GraphQLOutputType | GraphQLInputType;
			var ref= (fieldSchema as FieldRefDescriptor).ref;
			//* Basic data
			if(typeof ref==='undefined')
				throw new Error(`Missing reference on : ${currentNodeName}::${fieldKey}`);
			else if(ref === String)
				targetFieldGql= GraphQLString;
			else if(ref === Number)
				targetFieldGql= GraphQLFloat;
			else if(ref === Boolean)
				targetFieldGql= GraphQLBoolean;
			//* Scalar or enum
			else if(ref instanceof GraphQLScalarType || ref instanceof GraphQLEnumType)
				targetFieldGql= ref;
			//* Union
			else if(ref instanceof Union)
				targetFieldGql= _genUnion(ref);
			else {
				//* Input or Output Object
				ref= _genRef(ref, fieldKey, nextNodeType);
				// Load reference
				ref= _nodeNamePostfix(ref, nextNodeType);
				refNode= _getNode(ref, nextNodeType);
				targetFieldGql= refNode.gql!;
			}
			// Wrap with list and nonNull
			var wrappersQueueI= wrappersQueue.length;
			while(--wrappersQueueI >=0){
				switch(wrappersQueue[wrappersQueueI]){
					case WrappedQueueWrappers.LIST:
						targetFieldGql= new GraphQLList(targetFieldGql);
						break
					case WrappedQueueWrappers.NON_NULL:
						targetFieldGql= new GraphQLNonNull(targetFieldGql);
						break
					default:
						throw new Error(`Illegal value for switch: ${wrappersQueue[wrappersQueueI]}`);		
				}
			}
			//Check for resolver args
			var fieldResolverArgs: GraphQLFieldConfigArgumentMap|undefined= undefined;
			var argV: any= rootFieldSchema.args;
			if(argV){
				//* Argument
				var argRef= argV._.ref;
				if(argRef == null)
					throw new Error(`Missing arg at ${currentNodeName}::${fieldKey}`);
				argRef= _genRef(argRef, fieldKey, ObjectInOut.ARG);
				argRef+= '_Arg';
				// Load reference
				var argNode= _getNode(argRef, ObjectInOut.ARG);
				fieldResolverArgs= argNode.fields as GraphQLFieldConfigArgumentMap;
			}
			// create field
			if(currentNodeType=== ObjectInOut.OUTPUT)
				(fields as GraphQLFieldConfigMap<any, any>)[fieldKey]= {
					type:				targetFieldGql as GraphQLOutputType,
					args:				fieldResolverArgs,
					resolve:			rootFieldSchema.resolver as GraphQLFieldResolver<any, any, { [argName: string]: any; }>,
					subscribe:			rootFieldSchema.subscribe as GraphQLFieldResolver<any, any, { [argName: string]: any; }>,
					deprecationReason:	rootFieldSchema.deprecated,
					description:		rootFieldSchema.comment
				};
			else if(currentNodeType === ObjectInOut.ARG)
				(fields as GraphQLFieldConfigArgumentMap)[fieldKey]= {
					type:				targetFieldGql as GraphQLInputType,
					defaultValue:		rootFieldSchema.default,
					description:		rootFieldSchema.comment,
					deprecationReason:	rootFieldSchema.deprecated
				}
			else
				(fields as GraphQLInputFieldMap)[fieldKey]= {
					name:				rootFieldSchema.name || fieldKey,
					type:				targetFieldGql as GraphQLInputType,
					defaultValue:		rootFieldSchema.default,
					description:		rootFieldSchema.comment,
					deprecationReason:	rootFieldSchema.deprecated,
					extensions:			undefined
				};
		}
	}
	// Return Graphql schema
	return new GraphQLSchema({
		query:			refMap.get('Query')?.gql as GraphQLObjectType<any, any>|undefined,
		mutation:		refMap.get('Mutation')?.gql as GraphQLObjectType<any, any>|undefined,
		subscription:	refMap.get('Subscription')?.gql as GraphQLObjectType<any, any>|undefined
	});
}

/** Get object entries iterator */
function* _objEntries(obj: Record<string, FieldSchema>): IterableIterator<[string, FieldSchema]>{
	var k: string, v: any;
	for(k in obj){
		v= obj[k];
		if(!(v instanceof FieldSchema))
			v= new FieldSchema().type(v);
		yield [k, v];
	}
}

/** Convert enum properties into string */
export type strEnumProps<T> ={
	[k in keyof T]: string
};

/** Generate Graphql enumerations */
const gqlEnumKeyRegex= /^[^\d]/;
export function gqlEnum(name: string, enumMap: Record<string, string|number>, enumDesc?: Record<string, string>): GraphQLEnumType
export function gqlEnum(name: string, description:string, enumMap: Record<string, string|number>, enumDesc?: Record<string, string>): GraphQLEnumType
export function gqlEnum(name: string, a:any, b?: any, c?: any){
	// Load params
	var description, enumMap, enumDesc;
	if(typeof a=== 'string'){
		description= a;
		enumMap= b;
		enumDesc= c;
	} else {
		enumMap= a;
		enumDesc= b;
	}
	// Create values
	var values: GraphQLEnumValueConfigMap= {};
	var k;
	if(enumDesc)
		for(k in enumMap)
			if(typeof k=== 'string' && gqlEnumKeyRegex.test(k))
				values[k]= {
					value:			enumMap[k],
					description:	enumDesc[k]
				};
	else
		for(k in enumMap)
			if(typeof k=== 'string' && gqlEnumKeyRegex.test(k))
				values[k]= { value:	enumMap[k] };
	// Create enum
	return new GraphQLEnumType({
		name,
		description,
		values: values
		// extensions?: Maybe<Readonly<GraphQLEnumTypeExtensions>>;
		// astNode?: Maybe<EnumTypeDefinitionNode>;
		// extensionASTNodes?: Maybe<ReadonlyArray<EnumTypeExtensionNode>>;
	});
}