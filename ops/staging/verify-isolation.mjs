import { readFile } from 'node:fs/promises';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';

const source = await readFile(new URL('./foundation.json', import.meta.url), 'utf8');
const template = JSON.parse(source);
const resources = template.Resources;
const serialized = JSON.stringify(template);
assert.equal(resources.Vpc.Properties.CidrBlock, '10.88.0.0/16');
assert.equal(resources.Database.Properties.DBName, 'trackmyrmc_staging');
assert.equal(resources.Database.Properties.PubliclyAccessible, false);
assert.equal(resources.Database.Properties.StorageEncrypted, true);
assert.equal(resources.Database.Properties.DeletionProtection, true);
assert.equal(resources.Database.Properties.ManageMasterUserPassword, true);
assert.equal(resources.Database.Properties.MasterUserPassword, undefined);
assert.equal(resources.Database.Properties.MultiAZ, false);
assert.equal(resources.Database.Properties.DBInstanceClass, 'db.t4g.micro');
assert.deepEqual(template.Parameters.ComputeSize.AllowedValues, ['t3.small']);
assert.deepEqual(template.Rules.TrackMyRMCAccountOnly.Assertions[0].Assert['Fn::Equals'], [{ Ref: 'AWS::AccountId' }, '260234292958']);
assert.deepEqual(template.Rules.StagingStackNameOnly.Assertions[0].Assert['Fn::Equals'], [{ Ref: 'AWS::StackName' }, 'trackmyrmc-staging']);
assert.equal(resources.AppSecurityGroup.Properties.SecurityGroupIngress?.length ?? 0, 0);
assert.deepEqual(resources.DatabaseSecurityGroup.Properties.SecurityGroupIngress, [{ IpProtocol: 'tcp', FromPort: 5432, ToPort: 5432, SourceSecurityGroupId: { Ref: 'AppSecurityGroup' }, Description: 'PostgreSQL from the isolated staging host only' }]);
assert.ok(resources.AppSecurityGroup.Properties.SecurityGroupEgress.every(rule => rule.FromPort === 443 || (rule.FromPort === 5432 && rule.CidrIp === '10.88.0.0/16')));
assert.equal(resources.AppHost.Properties.MetadataOptions.HttpTokens, 'required');
assert.equal(resources.AppHost.Properties.CreditSpecification.CPUCredits, 'standard');
assert.equal(resources.AppHost.Properties.BlockDeviceMappings[0].Ebs.Encrypted, true);
assert.equal(resources.AppHost.Properties.BlockDeviceMappings[0].Ebs.DeleteOnTermination, true);
assert.deepEqual(resources.InstanceRole.Properties.ManagedPolicyArns.find(arn => arn.Ref === 'RuntimePolicy'), { Ref: 'RuntimePolicy' });
const statements = resources.RuntimePolicy.Properties.PolicyDocument.Statement;
const allowedSecrets = statements.find(statement => statement.Effect === 'Allow' && statement.Action.includes('secretsmanager:GetSecretValue'));
assert.deepEqual(allowedSecrets.Resource, [{ Ref: 'AppSecret' }, { Ref: 'OtpSecret' }, { Ref: 'ApplicationDatabaseSecret' }]);
assert.deepEqual(statements.find(statement => statement.Sid === 'DenyOtherSecretReads').NotResource, allowedSecrets.Resource);
assert.equal(statements.find(statement => statement.Sid === 'DenyNonStagingParameterReads').Effect, 'Deny');
assert.equal(statements.find(statement => statement.Sid === 'DenyInfrastructureMutationAndRoleAssumption').Effect, 'Deny');
assert.equal(statements.find(statement => statement.Sid === 'DenyOtherObjectReads').Effect, 'Deny');
for (const [name, resource] of Object.entries(resources)) {
  assert.ok(!['AWS::EC2::VPCPeeringConnection', 'AWS::EC2::TransitGatewayAttachment', 'AWS::EC2::VPCCidrBlock'].includes(resource.Type), `Unexpected network connection: ${name}`);
  if (resource.Type === 'AWS::SecretsManager::Secret' || resource.Type === 'AWS::S3::Bucket' || resource.Type === 'AWS::RDS::DBInstance') {
    assert.equal(resource.DeletionPolicy, 'Retain');
    assert.equal(resource.UpdateReplacePolicy, 'Retain');
  }
}
function checkReferences(value) {
  if (!value || typeof value !== 'object') return;
  assert.equal(value['Fn::ImportValue'], undefined, 'No external stack imports');
  if (value.Ref) assert.ok(value.Ref.startsWith('AWS::') || resources[value.Ref] || template.Parameters[value.Ref], 'Only local references are allowed');
  for (const nested of Object.values(value)) checkReferences(nested);
}
checkReferences(template);
assert.ok(!/(i-0598aad6e6d729c69|vpc-07d|sg-09d|trackmyrmc-postgres|gold-e|goldetech)/i.test(serialized), 'Production identifiers must not enter the foundation');
assert.ok(!/"(?:VpcId|SubnetId|SourceSecurityGroupId)":"(?:vpc-|subnet-|sg-)/.test(serialized));
console.log(JSON.stringify({ status: 'COMPLETE', scope: 'static template isolation; deployed enforcement not yet tested', resources: Object.keys(resources).length, sha256: createHash('sha256').update(source).digest('hex'), provisioning: 'BLOCKED' }));
