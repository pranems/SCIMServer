// Virtual network + private DNS configuration for SCIMServer Azure Container Apps

@description('Deployment location')
param location string = resourceGroup().location

@description('Name of the virtual network created for Container Apps + private endpoints')
param vnetName string

@description('Address prefix for the virtual network')
param addressPrefix string = '10.40.0.0/16'

@description('Subnet prefix for Container Apps infrastructure components (delegated to Microsoft.App/environments)')
param infrastructureSubnetPrefix string = '10.40.0.0/21'

@description('Subnet prefix for Container Apps workloads (delegated to Microsoft.App/environments)')
param workloadSubnetPrefix string = '10.40.8.0/21'

@description('Subnet prefix dedicated to private endpoints such as Storage')
param privateEndpointSubnetPrefix string = '10.40.16.0/24'

var infrastructureSubnetName = 'aca-infra'
var workloadSubnetName = 'aca-runtime'
var privateEndpointSubnetName = 'private-endpoints'

resource vnet 'Microsoft.Network/virtualNetworks@2023-09-01' = {
  name: vnetName
  location: location
  properties: {
    addressSpace: {
      addressPrefixes: [
        addressPrefix
      ]
    }
    subnets: [
      {
        name: infrastructureSubnetName
        properties: {
          addressPrefix: infrastructureSubnetPrefix
          delegations: [
            {
              name: 'Microsoft.App.environments'
              properties: {
                serviceName: 'Microsoft.App/environments'
              }
            }
          ]
          privateEndpointNetworkPolicies: 'Disabled'
          privateLinkServiceNetworkPolicies: 'Disabled'
        }
      }
      {
        name: workloadSubnetName
        properties: {
          addressPrefix: workloadSubnetPrefix
          delegations: [
            {
              name: 'Microsoft.App.environments'
              properties: {
                serviceName: 'Microsoft.App/environments'
              }
            }
          ]
          privateEndpointNetworkPolicies: 'Disabled'
          privateLinkServiceNetworkPolicies: 'Disabled'
        }
      }
      {
        name: privateEndpointSubnetName
        properties: {
          addressPrefix: privateEndpointSubnetPrefix
          privateEndpointNetworkPolicies: 'Disabled'
          privateLinkServiceNetworkPolicies: 'Disabled'
        }
      }
    ]
  }
  tags: {
    project: 'scimserver'
    component: 'networking'
  }
}

output vnetId string = vnet.id
output infrastructureSubnetId string = resourceId('Microsoft.Network/virtualNetworks/subnets', vnet.name, infrastructureSubnetName)
output workloadSubnetId string = resourceId('Microsoft.Network/virtualNetworks/subnets', vnet.name, workloadSubnetName)
output privateEndpointSubnetId string = resourceId('Microsoft.Network/virtualNetworks/subnets', vnet.name, privateEndpointSubnetName)
