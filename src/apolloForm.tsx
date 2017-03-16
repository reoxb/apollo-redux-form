import * as React from 'react';
import {Component } from '@types/react';

const invariant = require('invariant');

import {
  visit,
  DocumentNode,
  DefinitionNode,
  VariableDefinitionNode,
  OperationDefinitionNode,
  NamedTypeNode,
  NonNullTypeNode,
  VariableNode,
  TypeNode,
  TypeDefinitionNode,
  EnumTypeDefinitionNode,
  EnumValueDefinitionNode
} from 'graphql';


import {
  FormDecorator,
  Form,
} from '@types/redux-form';

import { graphql } from 'react-apollo'
import { Field, reduxForm } from 'redux-form'

import { fromCamelToHuman } from './utils'

interface TypeDefinitionsTable {
  [type: string]: TypeDefinitionNode;
}

interface IMutationDefinition {
  name: string;
  variables: VariableDefinitionNode[];
  types: TypeDefinitionsTable;
}

function findQuery(document: DocumentNode): IMutationDefinition {
  let variables, name, types: TypeDefinitionsTable = {};
  const queries = document.definitions.filter(
    (x: DefinitionNode) => x.kind === 'OperationDefinition' && x.operation === 'query',
  );
  invariant((queries.length === 1),
    // tslint:disable-line
    `apollo-redux-form expects exactly one query`,
  );
  const definitions = queries;
  const definition = definitions[0] as OperationDefinitionNode;
  variables = definition.variableDefinitions || [];
  let hasName = definition.name && definition.name.kind === 'Name';
  name = hasName && definition.name ? definition.name.value : 'data';
  return { name, variables, types };
}

function parse(document: DocumentNode): IMutationDefinition {

  let variables, name, types: TypeDefinitionsTable = {};

  const fragments = document.definitions.filter(
    (x: DefinitionNode) => x.kind === 'FragmentDefinition',
  );

  document.definitions.filter(
    (x: DefinitionNode) => x.kind === 'EnumTypeDefinition' ||  x.kind === 'InputObjectTypeDefinition' ,
  ).forEach( (type: TypeDefinitionNode): void => { types[ type.name.value ] = type;});

  const queries = document.definitions.filter(
    (x: DefinitionNode) => x.kind === 'OperationDefinition' && x.operation === 'query',
  );

  const mutations = document.definitions.filter(
    (x: DefinitionNode) => x.kind === 'OperationDefinition' && x.operation === 'mutation',
  );

  const subscriptions = document.definitions.filter(
    (x: DefinitionNode) => x.kind === 'OperationDefinition' && x.operation === 'subscription',
  );

  invariant(!fragments.length || (queries.length || mutations.length || subscriptions.length),
    `Passing only a fragment to 'graphql' is not yet supported. You must include a query, subscription or mutation as well`,
  );
  invariant(((queries.length + mutations.length + subscriptions.length) <= 1),
    // tslint:disable-line
    `apollo-redux-form only supports a mutation per HOC. ${document} had ${queries.length} queries, ${subscriptions.length} subscriptions and ${mutations.length} muations. You can use 'compose' to join multiple operation types to a component`,
  );

  const definitions = mutations;

  invariant(definitions.length === 1,
    // tslint:disable-line
    `apollo-redux-form only supports one defintion per HOC. ${document} had ${definitions.length} definitions.`,
  );

  const definition = definitions[0] as OperationDefinitionNode;
  variables = definition.variableDefinitions || [];
  let hasName = definition.name && definition.name.kind === 'Name';
  name = hasName && definition.name ? definition.name.value : 'data';
  return { name, variables, types };

}

const scalarTypeToField: any = {
  'String': { component: 'input', type: 'text' },
  'Int': { component: 'input', type: 'number' },
  'Float': { component: 'input', type: 'number' },
  'Boolean': { component: 'input', type: 'checkbox' },
  'ID': { component: 'input', type: 'hidden' }
};

function buildFieldsVisitor(options: any): any{
  return {
    VariableDefinition(node: VariableDefinitionNode) {
      const { variable: { name: {value} }, type } = node;
      const { inner, ...props } = visit(type, buildFieldsVisitor(options), {});
      return (
        <div key={value}>
          <label>{fromCamelToHuman(value)}</label>
          <div>
            <Field name={value} {...props} >
              {inner}
            </Field>
          </div>
        </div>
      );
    },
    NamedType(node: NamedTypeNode) {
      const { types, resolvers } = options;
      const { name: { value } } = node;
      let props;

      props = scalarTypeToField[value];
      if (!!props){
        return props;
      }

      const typeDef = types[value];
      invariant( !!typeDef,
        // tslint:disable-line
        `user defined field ${value} does not correspond to any known graphql types`,
      );
      props = resolvers && resolvers[ value ]
      if (!!props){ // user defined type
        return props
      } else if ( typeDef.kind === 'EnumTypeDefinition' ){
        const options = (typeDef as EnumTypeDefinitionNode)
            .values.map( ({name: {value}}:EnumValueDefinitionNode) => <option key={value} value={value}>{value}</option> );
        return { component: 'select', inner: options };
      }

      invariant( false,
        // tslint:disable-line
        `not able to find a definition for type ${value}`,
      );
    },
    NonNullType(node: NonNullTypeNode){
      const { type } = node;
      const props = visit(type, buildFieldsVisitor(options), {});
      return { required:true, ...props };
    }
  };
}

export function buildForm(
  document: DocumentNode,
  {initialValues, resolvers}: ApolloFormInterface = {}): any {

  const { name, variables, types } = parse(document);
  const fields = visit(variables, buildFieldsVisitor({types, resolvers}), {});
  const requiredFields =
    variables.filter( (variable) => variable.type.kind === 'NonNullType')
             .map( (variable) => variable.variable.name.value );
  const withForm = reduxForm({
    form: name,
    initialValues,
    validate(values: any){
      const errors: any = {};
      requiredFields.forEach( (fieldName: string) => {
        if ( !values[fieldName] ){
          errors[ fieldName ] = 'Required field.'
        }
      });
      return errors;
    }
  });
  return withForm( class FormComponent extends React.Component<any, any> {
    render(){
      const { handleSubmit, pristine, submitting } = this.props;
      return (
        <form onSubmit={handleSubmit}>
          {fields}
          <button type='submit' disabled={pristine || submitting}>Submit</button>
        </form>
      );
    }
  });
}

export interface FormResolver {
  [key: string]: any;
  component: string;
  format?(value:string): string;
}

export interface FormResolvers {
  [key: string]: FormResolver;
}


export interface ApolloFormInterface {
  initialValues?: FormData;
  loading?: boolean;
  resolvers?: FormResolvers;
  onSubmit?: any;
}

export const initForm = (document: DocumentNode, options: any): any => graphql(document, {
  options,
  props: ({ data }) => {
    const {loading, error} = data;
    const { name } = findQuery(document);
    const initialValues = data[name];
    return {
      loading,
      initialValues,
    };
  }
});

export function apolloForm(
  document: DocumentNode,
  // apollo options e.g.
  // * updateQueries
  //
  options: ApolloFormInterface = {}
){

  const { onSubmit } = options;

  const withData = graphql(document, {
    props: ({ mutate }) => ({
      // variables contains right fields
      // because form is created from mutation variables
      handleSubmit: (variables: any) => {
        mutate({
          variables,
          ... options
        }).then(onSubmit).catch(console.log)
      }
    })
  });

  // XXX add onSubmit to Form
  const Form = buildForm(document, options) as any;

  return withData( (props: any) => {
    const { handleSubmit, ...rest } = props;
    return (
      <Form onSubmit={handleSubmit} {...rest}/>
    );
  });
}
