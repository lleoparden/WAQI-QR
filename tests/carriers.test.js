import test from 'node:test';
import assert from 'node:assert/strict';
import { identifyCarrier, normalizeAsn } from '../web/landing/carriers.js';

test('Telecom Egypt / WE is identified from AS8452 or TE Data naming', () => {
  const carrier = identifyCarrier({ isp: 'TE-AS', org: 'TE Data', asn: 'AS8452' });
  assert.equal(carrier.id, 'telecom-egypt');
  assert.equal(carrier.name, 'Telecom Egypt (WE)');
  assert.equal(carrier.nameAr, 'المصرية للاتصالات (WE)');
  assert.equal(carrier.wallet, 'WE Pay');
  assert.equal(carrier.walletAr, 'WE Pay');
  assert.equal(carrier.type, 'fixed');
  assert.equal(carrier.matchedBy, 'asn');
});

test('Vodafone is identified from its ASN or operator name', () => {
  const byAsn = identifyCarrier({ isp: 'Vodafone Data', asn: 24835 });
  assert.equal(byAsn.id, 'vodafone');
  assert.equal(byAsn.wallet, 'Vodafone Cash');
  assert.equal(byAsn.type, 'mobile');

  const byName = identifyCarrier({ isp: 'Vodafone Egypt' });
  assert.equal(byName.id, 'vodafone');
  assert.equal(byName.matchedBy, 'name');
});

test('Mobinil and Link Egypt resolve to Orange Egypt', () => {
  const mobinil = identifyCarrier({
    isp: 'The Egyptian Company for Mobile Services (Mobinil)',
    asn: 'AS37069',
  });
  assert.equal(mobinil.id, 'orange');
  assert.equal(mobinil.wallet, 'Orange Cash');

  const link = identifyCarrier({ isp: 'Link Egypt (Link.NET)', asn: 'AS24863' });
  assert.equal(link.id, 'orange');
});

test('Etisalat Misr resolves to Etisalat Egypt (e&)', () => {
  const carrier = identifyCarrier({ isp: 'ETISALAT MISR', asn: 'AS36992' });
  assert.equal(carrier.id, 'etisalat');
  assert.equal(carrier.name, 'Etisalat Egypt (e&)');
  assert.equal(carrier.wallet, 'Etisalat Cash');
});

test('NOOR is identified without inventing a wallet', () => {
  const carrier = identifyCarrier({ isp: 'The Noor Group', asn: 'AS20928' });
  assert.equal(carrier.id, 'noor');
  assert.equal(carrier.type, 'fixed');
  assert.equal(carrier.wallet, '');
});

test('unknown operators stay unknown instead of guessing', () => {
  assert.equal(identifyCarrier({ isp: 'Some Cloud Provider', asn: 'AS13335' }), null);
  assert.equal(identifyCarrier({ isp: '', org: '', asn: '' }), null);
});

test('ASNs normalize only when they are actually numeric', () => {
  assert.equal(normalizeAsn('AS8452'), '8452');
  assert.equal(normalizeAsn('as 8452'), '8452');
  assert.equal(normalizeAsn(8452), '8452');
  assert.equal(normalizeAsn('AS-8452'), '');
});
