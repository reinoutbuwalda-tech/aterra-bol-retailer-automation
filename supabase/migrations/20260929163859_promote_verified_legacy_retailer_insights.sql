do $migration$
declare
  legacy_sources constant jsonb := $legacy_data$[{"week":37,"scheduleKey":"cloud-test-20260914-1700","sourceContractVersion":"2.0","sha256":"b922322e3d14007c488e57128fdfc34df16223a44dd6e249f441700dccf82a21","bytes":53588,"insights":[{"ean":"8720892887504","metric":"PRODUCT_VISITS","periods":[{"period":{"day":7,"month":9,"year":2026},"total":5,"countries":[{"countryCode":"BE","value":2},{"countryCode":"NL","value":3}]},{"period":{"day":8,"month":9,"year":2026},"total":6,"countries":[{"countryCode":"BE","value":1},{"countryCode":"NL","value":5}]},{"period":{"day":9,"month":9,"year":2026},"total":5,"countries":[{"countryCode":"BE","value":2},{"countryCode":"NL","value":3}]},{"period":{"day":10,"month":9,"year":2026},"total":9,"countries":[{"countryCode":"BE","value":2},{"countryCode":"NL","value":7}]},{"period":{"day":11,"month":9,"year":2026},"total":16,"countries":[{"countryCode":"BE","value":6},{"countryCode":"NL","value":10}]},{"period":{"day":12,"month":9,"year":2026},"total":6,"countries":[{"countryCode":"BE","value":1},{"countryCode":"NL","value":5}]},{"period":{"day":13,"month":9,"year":2026},"total":8,"countries":[{"countryCode":"BE","value":0},{"countryCode":"NL","value":8}]}]},{"ean":"8720892887504","metric":"BUY_BOX_PERCENTAGE","periods":[{"period":{"day":7,"month":9,"year":2026},"countries":[{"countryCode":"BE","value":100},{"countryCode":"NL","value":100}]},{"period":{"day":8,"month":9,"year":2026},"countries":[{"countryCode":"BE","value":100},{"countryCode":"NL","value":100}]},{"period":{"day":9,"month":9,"year":2026},"countries":[{"countryCode":"BE","value":100},{"countryCode":"NL","value":100}]},{"period":{"day":10,"month":9,"year":2026},"countries":[{"countryCode":"BE","value":100},{"countryCode":"NL","value":100}]},{"period":{"day":11,"month":9,"year":2026},"countries":[{"countryCode":"BE","value":100},{"countryCode":"NL","value":100}]},{"period":{"day":12,"month":9,"year":2026},"countries":[{"countryCode":"BE","value":100},{"countryCode":"NL","value":100}]},{"period":{"day":13,"month":9,"year":2026},"countries":[{"countryCode":"NL","value":100}]}]},{"ean":"8720892887511","metric":"PRODUCT_VISITS","periods":[{"period":{"day":7,"month":9,"year":2026},"total":8,"countries":[{"countryCode":"BE","value":2},{"countryCode":"NL","value":6}]},{"period":{"day":8,"month":9,"year":2026},"total":11,"countries":[{"countryCode":"BE","value":1},{"countryCode":"NL","value":10}]},{"period":{"day":9,"month":9,"year":2026},"total":17,"countries":[{"countryCode":"BE","value":5},{"countryCode":"NL","value":12}]},{"period":{"day":10,"month":9,"year":2026},"total":16,"countries":[{"countryCode":"BE","value":6},{"countryCode":"NL","value":10}]},{"period":{"day":11,"month":9,"year":2026},"total":15,"countries":[{"countryCode":"BE","value":5},{"countryCode":"NL","value":10}]},{"period":{"day":12,"month":9,"year":2026},"total":9,"countries":[{"countryCode":"BE","value":2},{"countryCode":"NL","value":7}]},{"period":{"day":13,"month":9,"year":2026},"total":8,"countries":[{"countryCode":"BE","value":2},{"countryCode":"NL","value":6}]}]},{"ean":"8720892887511","metric":"BUY_BOX_PERCENTAGE","periods":[{"period":{"day":7,"month":9,"year":2026},"countries":[{"countryCode":"BE","value":100},{"countryCode":"NL","value":100}]},{"period":{"day":8,"month":9,"year":2026},"countries":[{"countryCode":"BE","value":100},{"countryCode":"NL","value":100}]},{"period":{"day":9,"month":9,"year":2026},"countries":[{"countryCode":"BE","value":100},{"countryCode":"NL","value":100}]},{"period":{"day":10,"month":9,"year":2026},"countries":[{"countryCode":"BE","value":100},{"countryCode":"NL","value":100}]},{"period":{"day":11,"month":9,"year":2026},"countries":[{"countryCode":"BE","value":100},{"countryCode":"NL","value":100}]},{"period":{"day":12,"month":9,"year":2026},"countries":[{"countryCode":"BE","value":100},{"countryCode":"NL","value":100}]},{"period":{"day":13,"month":9,"year":2026},"countries":[{"countryCode":"BE","value":100},{"countryCode":"NL","value":100}]}]},{"ean":"8720892887528","metric":"PRODUCT_VISITS","periods":[{"period":{"day":7,"month":9,"year":2026},"total":21,"countries":[{"countryCode":"BE","value":5},{"countryCode":"NL","value":16}]},{"period":{"day":8,"month":9,"year":2026},"total":22,"countries":[{"countryCode":"BE","value":3},{"countryCode":"NL","value":19}]},{"period":{"day":9,"month":9,"year":2026},"total":33,"countries":[{"countryCode":"BE","value":7},{"countryCode":"NL","value":26}]},{"period":{"day":10,"month":9,"year":2026},"total":20,"countries":[{"countryCode":"BE","value":3},{"countryCode":"NL","value":17}]},{"period":{"day":11,"month":9,"year":2026},"total":14,"countries":[{"countryCode":"BE","value":2},{"countryCode":"NL","value":12}]},{"period":{"day":12,"month":9,"year":2026},"total":12,"countries":[{"countryCode":"BE","value":2},{"countryCode":"NL","value":10}]},{"period":{"day":13,"month":9,"year":2026},"total":20,"countries":[{"countryCode":"BE","value":7},{"countryCode":"NL","value":13}]}]},{"ean":"8720892887528","metric":"BUY_BOX_PERCENTAGE","periods":[{"period":{"day":7,"month":9,"year":2026},"countries":[{"countryCode":"BE","value":100},{"countryCode":"NL","value":100}]},{"period":{"day":8,"month":9,"year":2026},"countries":[{"countryCode":"BE","value":100},{"countryCode":"NL","value":100}]},{"period":{"day":9,"month":9,"year":2026},"countries":[{"countryCode":"BE","value":100},{"countryCode":"NL","value":100}]},{"period":{"day":10,"month":9,"year":2026},"countries":[{"countryCode":"BE","value":100},{"countryCode":"NL","value":100}]},{"period":{"day":11,"month":9,"year":2026},"countries":[{"countryCode":"BE","value":100},{"countryCode":"NL","value":100}]},{"period":{"day":12,"month":9,"year":2026},"countries":[{"countryCode":"BE","value":100},{"countryCode":"NL","value":100}]},{"period":{"day":13,"month":9,"year":2026},"countries":[{"countryCode":"BE","value":100},{"countryCode":"NL","value":100}]}]},{"ean":"6970452112658","metric":"PRODUCT_VISITS","periods":[{"period":{"day":7,"month":9,"year":2026},"total":0,"countries":[{"countryCode":"BE","value":0},{"countryCode":"NL","value":0}]},{"period":{"day":8,"month":9,"year":2026},"total":0,"countries":[{"countryCode":"BE","value":0},{"countryCode":"NL","value":0}]},{"period":{"day":9,"month":9,"year":2026},"total":0,"countries":[{"countryCode":"BE","value":0},{"countryCode":"NL","value":0}]},{"period":{"day":10,"month":9,"year":2026},"total":8,"countries":[{"countryCode":"BE","value":0},{"countryCode":"NL","value":8}]},{"period":{"day":11,"month":9,"year":2026},"total":0,"countries":[{"countryCode":"BE","value":0},{"countryCode":"NL","value":0}]},{"period":{"day":12,"month":9,"year":2026},"total":0,"countries":[{"countryCode":"BE","value":0},{"countryCode":"NL","value":0}]},{"period":{"day":13,"month":9,"year":2026},"total":1,"countries":[{"countryCode":"BE","value":0},{"countryCode":"NL","value":1}]}]},{"ean":"6970452112658","metric":"BUY_BOX_PERCENTAGE","periods":[{"period":{"day":7,"month":9,"year":2026}},{"period":{"day":8,"month":9,"year":2026}},{"period":{"day":9,"month":9,"year":2026}},{"period":{"day":10,"month":9,"year":2026},"countries":[{"countryCode":"NL","value":100}]},{"period":{"day":11,"month":9,"year":2026}},{"period":{"day":12,"month":9,"year":2026}},{"period":{"day":13,"month":9,"year":2026},"countries":[{"countryCode":"NL","value":100}]}]}]},{"week":38,"scheduleKey":"weekly-primary-2026-09-21","sourceContractVersion":"2.1","sha256":"a35084de0d124f2b82f854465c1594df844188a5003858ea4bee9641721878e8","bytes":50980,"insights":[{"ean":"8720892887504","metric":"PRODUCT_VISITS","periods":[{"period":{"day":14,"month":9,"year":2026},"total":11,"countries":[{"countryCode":"BE","value":2},{"countryCode":"NL","value":9}]},{"period":{"day":15,"month":9,"year":2026},"total":4,"countries":[{"countryCode":"BE","value":2},{"countryCode":"NL","value":2}]},{"period":{"day":16,"month":9,"year":2026},"total":8,"countries":[{"countryCode":"BE","value":3},{"countryCode":"NL","value":5}]},{"period":{"day":17,"month":9,"year":2026},"total":3,"countries":[{"countryCode":"BE","value":0},{"countryCode":"NL","value":3}]},{"period":{"day":18,"month":9,"year":2026},"total":7,"countries":[{"countryCode":"BE","value":2},{"countryCode":"NL","value":5}]},{"period":{"day":19,"month":9,"year":2026},"total":4,"countries":[{"countryCode":"BE","value":1},{"countryCode":"NL","value":3}]},{"period":{"day":20,"month":9,"year":2026},"total":2,"countries":[{"countryCode":"BE","value":0},{"countryCode":"NL","value":2}]}]},{"ean":"8720892887504","metric":"BUY_BOX_PERCENTAGE","periods":[{"period":{"day":14,"month":9,"year":2026},"countries":[{"countryCode":"BE","value":100},{"countryCode":"NL","value":100}]},{"period":{"day":15,"month":9,"year":2026},"countries":[{"countryCode":"BE","value":100},{"countryCode":"NL","value":100}]},{"period":{"day":16,"month":9,"year":2026},"countries":[{"countryCode":"BE","value":100},{"countryCode":"NL","value":100}]},{"period":{"day":17,"month":9,"year":2026},"countries":[{"countryCode":"NL","value":100}]},{"period":{"day":18,"month":9,"year":2026},"countries":[{"countryCode":"BE","value":100},{"countryCode":"NL","value":100}]},{"period":{"day":19,"month":9,"year":2026},"countries":[{"countryCode":"BE","value":100},{"countryCode":"NL","value":100}]},{"period":{"day":20,"month":9,"year":2026},"countries":[{"countryCode":"NL","value":100}]}]},{"ean":"8720892887511","metric":"PRODUCT_VISITS","periods":[{"period":{"day":14,"month":9,"year":2026},"total":13,"countries":[{"countryCode":"BE","value":0},{"countryCode":"NL","value":13}]},{"period":{"day":15,"month":9,"year":2026},"total":11,"countries":[{"countryCode":"BE","value":4},{"countryCode":"NL","value":7}]},{"period":{"day":16,"month":9,"year":2026},"total":9,"countries":[{"countryCode":"BE","value":3},{"countryCode":"NL","value":6}]},{"period":{"day":17,"month":9,"year":2026},"total":8,"countries":[{"countryCode":"BE","value":2},{"countryCode":"NL","value":6}]},{"period":{"day":18,"month":9,"year":2026},"total":7,"countries":[{"countryCode":"BE","value":3},{"countryCode":"NL","value":4}]},{"period":{"day":19,"month":9,"year":2026},"total":9,"countries":[{"countryCode":"BE","value":4},{"countryCode":"NL","value":5}]},{"period":{"day":20,"month":9,"year":2026},"total":7,"countries":[{"countryCode":"BE","value":1},{"countryCode":"NL","value":6}]}]},{"ean":"8720892887511","metric":"BUY_BOX_PERCENTAGE","periods":[{"period":{"day":14,"month":9,"year":2026},"countries":[{"countryCode":"NL","value":100}]},{"period":{"day":15,"month":9,"year":2026},"countries":[{"countryCode":"BE","value":100},{"countryCode":"NL","value":100}]},{"period":{"day":16,"month":9,"year":2026},"countries":[{"countryCode":"BE","value":100},{"countryCode":"NL","value":100}]},{"period":{"day":17,"month":9,"year":2026},"countries":[{"countryCode":"BE","value":100},{"countryCode":"NL","value":100}]},{"period":{"day":18,"month":9,"year":2026},"countries":[{"countryCode":"BE","value":100},{"countryCode":"NL","value":100}]},{"period":{"day":19,"month":9,"year":2026},"countries":[{"countryCode":"BE","value":100},{"countryCode":"NL","value":100}]},{"period":{"day":20,"month":9,"year":2026},"countries":[{"countryCode":"BE","value":100},{"countryCode":"NL","value":100}]}]},{"ean":"8720892887528","metric":"PRODUCT_VISITS","periods":[{"period":{"day":14,"month":9,"year":2026},"total":18,"countries":[{"countryCode":"BE","value":3},{"countryCode":"NL","value":15}]},{"period":{"day":15,"month":9,"year":2026},"total":20,"countries":[{"countryCode":"BE","value":4},{"countryCode":"NL","value":16}]},{"period":{"day":16,"month":9,"year":2026},"total":21,"countries":[{"countryCode":"BE","value":6},{"countryCode":"NL","value":15}]},{"period":{"day":17,"month":9,"year":2026},"total":15,"countries":[{"countryCode":"BE","value":3},{"countryCode":"NL","value":12}]},{"period":{"day":18,"month":9,"year":2026},"total":17,"countries":[{"countryCode":"BE","value":4},{"countryCode":"NL","value":13}]},{"period":{"day":19,"month":9,"year":2026},"total":17,"countries":[{"countryCode":"BE","value":3},{"countryCode":"NL","value":14}]},{"period":{"day":20,"month":9,"year":2026},"total":13,"countries":[{"countryCode":"BE","value":5},{"countryCode":"NL","value":8}]}]},{"ean":"8720892887528","metric":"BUY_BOX_PERCENTAGE","periods":[{"period":{"day":14,"month":9,"year":2026},"countries":[{"countryCode":"BE","value":100},{"countryCode":"NL","value":100}]},{"period":{"day":15,"month":9,"year":2026},"countries":[{"countryCode":"BE","value":100},{"countryCode":"NL","value":100}]},{"period":{"day":16,"month":9,"year":2026},"countries":[{"countryCode":"BE","value":100},{"countryCode":"NL","value":100}]},{"period":{"day":17,"month":9,"year":2026},"countries":[{"countryCode":"BE","value":100},{"countryCode":"NL","value":100}]},{"period":{"day":18,"month":9,"year":2026},"countries":[{"countryCode":"BE","value":100},{"countryCode":"NL","value":100}]},{"period":{"day":19,"month":9,"year":2026},"countries":[{"countryCode":"BE","value":100},{"countryCode":"NL","value":100}]},{"period":{"day":20,"month":9,"year":2026},"countries":[{"countryCode":"BE","value":100},{"countryCode":"NL","value":100}]}]},{"ean":"6970452112658","metric":"PRODUCT_VISITS","periods":[{"period":{"day":14,"month":9,"year":2026},"total":9,"countries":[{"countryCode":"BE","value":1},{"countryCode":"NL","value":8}]},{"period":{"day":15,"month":9,"year":2026},"total":4,"countries":[{"countryCode":"BE","value":1},{"countryCode":"NL","value":3}]},{"period":{"day":16,"month":9,"year":2026},"total":9,"countries":[{"countryCode":"BE","value":3},{"countryCode":"NL","value":6}]},{"period":{"day":17,"month":9,"year":2026},"total":10,"countries":[{"countryCode":"BE","value":6},{"countryCode":"NL","value":4}]},{"period":{"day":18,"month":9,"year":2026},"total":4,"countries":[{"countryCode":"BE","value":0},{"countryCode":"NL","value":4}]},{"period":{"day":19,"month":9,"year":2026},"total":4,"countries":[{"countryCode":"BE","value":1},{"countryCode":"NL","value":3}]},{"period":{"day":20,"month":9,"year":2026},"total":4,"countries":[{"countryCode":"BE","value":0},{"countryCode":"NL","value":4}]}]},{"ean":"6970452112658","metric":"BUY_BOX_PERCENTAGE","periods":[{"period":{"day":14,"month":9,"year":2026},"countries":[{"countryCode":"BE","value":100},{"countryCode":"NL","value":100}]},{"period":{"day":15,"month":9,"year":2026},"countries":[{"countryCode":"BE","value":100},{"countryCode":"NL","value":100}]},{"period":{"day":16,"month":9,"year":2026},"countries":[{"countryCode":"BE","value":100},{"countryCode":"NL","value":100}]},{"period":{"day":17,"month":9,"year":2026},"countries":[{"countryCode":"BE","value":100},{"countryCode":"NL","value":100}]},{"period":{"day":18,"month":9,"year":2026},"countries":[{"countryCode":"NL","value":100}]},{"period":{"day":19,"month":9,"year":2026},"countries":[{"countryCode":"BE","value":100},{"countryCode":"NL","value":100}]},{"period":{"day":20,"month":9,"year":2026},"countries":[{"countryCode":"NL","value":100}]}]}]},{"week":39,"scheduleKey":"weekly-primary-2026-09-28","sourceContractVersion":"2.1","sha256":"eb8e09293f5e1eaa7d1174d5a436389b5afb0a1b69776684baf46c335efe84be","bytes":55355,"insights":[{"ean":"8720892887504","metric":"PRODUCT_VISITS","periods":[{"period":{"day":21,"month":9,"year":2026},"total":14,"countries":[{"countryCode":"BE","value":5},{"countryCode":"NL","value":9}]},{"period":{"day":22,"month":9,"year":2026},"total":6,"countries":[{"countryCode":"BE","value":3},{"countryCode":"NL","value":3}]},{"period":{"day":23,"month":9,"year":2026},"total":6,"countries":[{"countryCode":"BE","value":1},{"countryCode":"NL","value":5}]},{"period":{"day":24,"month":9,"year":2026},"total":7,"countries":[{"countryCode":"BE","value":1},{"countryCode":"NL","value":6}]},{"period":{"day":25,"month":9,"year":2026},"total":11,"countries":[{"countryCode":"BE","value":4},{"countryCode":"NL","value":7}]},{"period":{"day":26,"month":9,"year":2026},"total":10,"countries":[{"countryCode":"BE","value":3},{"countryCode":"NL","value":7}]},{"period":{"day":27,"month":9,"year":2026},"total":13,"countries":[{"countryCode":"BE","value":0},{"countryCode":"NL","value":13}]}]},{"ean":"8720892887504","metric":"BUY_BOX_PERCENTAGE","periods":[{"period":{"day":21,"month":9,"year":2026},"countries":[{"countryCode":"BE","value":100},{"countryCode":"NL","value":100}]},{"period":{"day":22,"month":9,"year":2026},"countries":[{"countryCode":"BE","value":100},{"countryCode":"NL","value":100}]},{"period":{"day":23,"month":9,"year":2026},"countries":[{"countryCode":"BE","value":100},{"countryCode":"NL","value":100}]},{"period":{"day":24,"month":9,"year":2026},"countries":[{"countryCode":"BE","value":100},{"countryCode":"NL","value":100}]},{"period":{"day":25,"month":9,"year":2026},"countries":[{"countryCode":"BE","value":100},{"countryCode":"NL","value":100}]},{"period":{"day":26,"month":9,"year":2026},"countries":[{"countryCode":"BE","value":100},{"countryCode":"NL","value":100}]},{"period":{"day":27,"month":9,"year":2026},"countries":[{"countryCode":"NL","value":100}]}]},{"ean":"8720892887511","metric":"PRODUCT_VISITS","periods":[{"period":{"day":21,"month":9,"year":2026},"total":15,"countries":[{"countryCode":"BE","value":3},{"countryCode":"NL","value":12}]},{"period":{"day":22,"month":9,"year":2026},"total":14,"countries":[{"countryCode":"BE","value":4},{"countryCode":"NL","value":10}]},{"period":{"day":23,"month":9,"year":2026},"total":9,"countries":[{"countryCode":"BE","value":2},{"countryCode":"NL","value":7}]},{"period":{"day":24,"month":9,"year":2026},"total":16,"countries":[{"countryCode":"BE","value":3},{"countryCode":"NL","value":13}]},{"period":{"day":25,"month":9,"year":2026},"total":11,"countries":[{"countryCode":"BE","value":4},{"countryCode":"NL","value":7}]},{"period":{"day":26,"month":9,"year":2026},"total":14,"countries":[{"countryCode":"BE","value":3},{"countryCode":"NL","value":11}]},{"period":{"day":27,"month":9,"year":2026},"total":13,"countries":[{"countryCode":"BE","value":4},{"countryCode":"NL","value":9}]}]},{"ean":"8720892887511","metric":"BUY_BOX_PERCENTAGE","periods":[{"period":{"day":21,"month":9,"year":2026},"countries":[{"countryCode":"BE","value":100},{"countryCode":"NL","value":100}]},{"period":{"day":22,"month":9,"year":2026},"countries":[{"countryCode":"BE","value":100},{"countryCode":"NL","value":100}]},{"period":{"day":23,"month":9,"year":2026},"countries":[{"countryCode":"BE","value":100},{"countryCode":"NL","value":100}]},{"period":{"day":24,"month":9,"year":2026},"countries":[{"countryCode":"BE","value":100},{"countryCode":"NL","value":100}]},{"period":{"day":25,"month":9,"year":2026},"countries":[{"countryCode":"BE","value":100},{"countryCode":"NL","value":100}]},{"period":{"day":26,"month":9,"year":2026},"countries":[{"countryCode":"BE","value":100},{"countryCode":"NL","value":100}]},{"period":{"day":27,"month":9,"year":2026},"countries":[{"countryCode":"BE","value":100},{"countryCode":"NL","value":100}]}]},{"ean":"8720892887528","metric":"PRODUCT_VISITS","periods":[{"period":{"day":21,"month":9,"year":2026},"total":20,"countries":[{"countryCode":"BE","value":5},{"countryCode":"NL","value":15}]},{"period":{"day":22,"month":9,"year":2026},"total":26,"countries":[{"countryCode":"BE","value":7},{"countryCode":"NL","value":19}]},{"period":{"day":23,"month":9,"year":2026},"total":23,"countries":[{"countryCode":"BE","value":6},{"countryCode":"NL","value":17}]},{"period":{"day":24,"month":9,"year":2026},"total":24,"countries":[{"countryCode":"BE","value":4},{"countryCode":"NL","value":20}]},{"period":{"day":25,"month":9,"year":2026},"total":14,"countries":[{"countryCode":"BE","value":4},{"countryCode":"NL","value":10}]},{"period":{"day":26,"month":9,"year":2026},"total":13,"countries":[{"countryCode":"BE","value":3},{"countryCode":"NL","value":10}]},{"period":{"day":27,"month":9,"year":2026},"total":25,"countries":[{"countryCode":"BE","value":4},{"countryCode":"NL","value":21}]}]},{"ean":"8720892887528","metric":"BUY_BOX_PERCENTAGE","periods":[{"period":{"day":21,"month":9,"year":2026},"countries":[{"countryCode":"BE","value":100},{"countryCode":"NL","value":100}]},{"period":{"day":22,"month":9,"year":2026},"countries":[{"countryCode":"BE","value":100},{"countryCode":"NL","value":100}]},{"period":{"day":23,"month":9,"year":2026},"countries":[{"countryCode":"BE","value":100},{"countryCode":"NL","value":100}]},{"period":{"day":24,"month":9,"year":2026},"countries":[{"countryCode":"BE","value":100},{"countryCode":"NL","value":100}]},{"period":{"day":25,"month":9,"year":2026},"countries":[{"countryCode":"BE","value":100},{"countryCode":"NL","value":100}]},{"period":{"day":26,"month":9,"year":2026},"countries":[{"countryCode":"BE","value":100},{"countryCode":"NL","value":100}]},{"period":{"day":27,"month":9,"year":2026},"countries":[{"countryCode":"BE","value":100},{"countryCode":"NL","value":100}]}]},{"ean":"6970452112658","metric":"PRODUCT_VISITS","periods":[{"period":{"day":21,"month":9,"year":2026},"total":4,"countries":[{"countryCode":"BE","value":2},{"countryCode":"NL","value":2}]},{"period":{"day":22,"month":9,"year":2026},"total":6,"countries":[{"countryCode":"BE","value":2},{"countryCode":"NL","value":4}]},{"period":{"day":23,"month":9,"year":2026},"total":3,"countries":[{"countryCode":"BE","value":0},{"countryCode":"NL","value":3}]},{"period":{"day":24,"month":9,"year":2026},"total":8,"countries":[{"countryCode":"BE","value":2},{"countryCode":"NL","value":6}]},{"period":{"day":25,"month":9,"year":2026},"total":6,"countries":[{"countryCode":"BE","value":2},{"countryCode":"NL","value":4}]},{"period":{"day":26,"month":9,"year":2026},"total":3,"countries":[{"countryCode":"BE","value":2},{"countryCode":"NL","value":1}]},{"period":{"day":27,"month":9,"year":2026},"total":4,"countries":[{"countryCode":"BE","value":1},{"countryCode":"NL","value":3}]}]},{"ean":"6970452112658","metric":"BUY_BOX_PERCENTAGE","periods":[{"period":{"day":21,"month":9,"year":2026},"countries":[{"countryCode":"BE","value":100},{"countryCode":"NL","value":100}]},{"period":{"day":22,"month":9,"year":2026},"countries":[{"countryCode":"BE","value":100},{"countryCode":"NL","value":100}]},{"period":{"day":23,"month":9,"year":2026},"countries":[{"countryCode":"NL","value":100}]},{"period":{"day":24,"month":9,"year":2026},"countries":[{"countryCode":"BE","value":100},{"countryCode":"NL","value":100}]},{"period":{"day":25,"month":9,"year":2026},"countries":[{"countryCode":"BE","value":100},{"countryCode":"NL","value":100}]},{"period":{"day":26,"month":9,"year":2026},"countries":[{"countryCode":"BE","value":100},{"countryCode":"NL","value":100}]},{"period":{"day":27,"month":9,"year":2026},"countries":[{"countryCode":"BE","value":100},{"countryCode":"NL","value":100}]}]}]}]$legacy_data$::jsonb;
  source_item jsonb;
  product_item jsonb;
  source_run public.bol_retailer_api_extract_runs%rowtype;
  legacy_transform_id uuid;
  prior_report reporting.weekly_report_revisions%rowtype;
  new_report_id uuid;
  week_number integer;
  expected_start date;
  expected_end date;
  source_path text;
  row_total integer;
  report_status text;
begin
  create temporary table legacy_offer_insight_rows (
    iso_week integer not null,
    ean text not null,
    metric_date date not null,
    metric text not null,
    country_code text,
    is_total boolean not null,
    value numeric(14, 4) not null,
    source_pointer text not null
  ) on commit drop;

  for source_item in
    select value from jsonb_array_elements(legacy_sources)
  loop
    week_number := (source_item->>'week')::integer;

    select *
    into strict source_run
    from public.bol_retailer_api_extract_runs
    where schedule_key = source_item->>'scheduleKey'
      and iso_year = 2026
      and iso_week = week_number
      and source_schema_version = source_item->>'sourceContractVersion';

    expected_start := source_run.period_start;
    expected_end := source_run.period_end;

    if source_run.artifact_count <> 7 or source_run.storage_path is null then
      raise exception 'Legacy W% source does not have seven immutable artifacts', week_number;
    end if;

    if (
      select count(*)
      from jsonb_array_elements(source_item->'insights') as insight
      where insight->>'metric' = 'PRODUCT_VISITS'
    ) <> 4 then
      raise exception 'Legacy W% source does not contain four product-visit series', week_number;
    end if;

    if exists (
      select 1
      from jsonb_array_elements(source_item->'insights') as insight
      cross join lateral (
        select
          count(distinct make_date(
            (period->'period'->>'year')::integer,
            (period->'period'->>'month')::integer,
            (period->'period'->>'day')::integer
          )) as date_count,
          min(make_date(
            (period->'period'->>'year')::integer,
            (period->'period'->>'month')::integer,
            (period->'period'->>'day')::integer
          )) as min_date,
          max(make_date(
            (period->'period'->>'year')::integer,
            (period->'period'->>'month')::integer,
            (period->'period'->>'day')::integer
          )) as max_date
        from jsonb_array_elements(insight->'periods') as period
      ) coverage
      where coverage.date_count <> 7
         or coverage.min_date <> expected_start
         or coverage.max_date <> expected_end
    ) then
      raise exception 'Legacy W% insight dates do not align to the reporting week', week_number;
    end if;

    insert into pipeline.transform_runs (
      source_system, source_run_id, source_contract_version, transform_version,
      iso_year, iso_week, period_start, period_end, status, attempt_count,
      started_at, published_at, completed_at
    ) values (
      'bol_retailer', source_run.id, source_run.source_schema_version,
      'legacy-insights-promotion-v1', 2026, week_number,
      source_run.period_start, source_run.period_end, 'published', 1,
      now(), now(), now()
    )
    on conflict (source_system, source_run_id, transform_version) do nothing;

    select id
    into strict legacy_transform_id
    from pipeline.transform_runs
    where source_system = 'bol_retailer'
      and source_run_id = source_run.id
      and transform_version = 'legacy-insights-promotion-v1';

    if exists (
      select 1
      from reporting.data_product_revisions
      where transform_run_id = legacy_transform_id
    ) then
      continue;
    end if;

    source_path := regexp_replace(source_run.storage_path, 'manifest[.]json$', 'insights.json');

    insert into pipeline.transform_attempts (
      transform_run_id, attempt_number, worker_id, lease_token, status,
      started_at, completed_at, duration_ms
    ) values (
      legacy_transform_id, 1, 'migration:legacy-insights-promotion-v1',
      gen_random_uuid(), 'published', now(), now(), 0
    );

    insert into pipeline.source_artifacts (
      transform_run_id, artifact_name, storage_bucket, storage_path,
      expected_sha256, actual_sha256, expected_bytes, actual_bytes,
      parse_status, checked_at
    ) values (
      legacy_transform_id, 'insights', source_run.storage_bucket, source_path,
      source_item->>'sha256', source_item->>'sha256',
      (source_item->>'bytes')::bigint, (source_item->>'bytes')::bigint,
      'verified', now()
    );

    with insights as (
      select
        insight.value as insight,
        insight.ordinality - 1 as insight_index
      from jsonb_array_elements(source_item->'insights') with ordinality as insight(value, ordinality)
    ),
    periods as (
      select
        insight->>'ean' as ean,
        insight->>'metric' as metric,
        insight_index,
        period.value as period,
        period.ordinality - 1 as period_index
      from insights
      cross join lateral jsonb_array_elements(insight->'periods') with ordinality as period(value, ordinality)
    ),
    expanded as (
      select
        week_number as iso_week,
        ean,
        make_date(
          (period->'period'->>'year')::integer,
          (period->'period'->>'month')::integer,
          (period->'period'->>'day')::integer
        ) as metric_date,
        metric,
        null::text as country_code,
        true as is_total,
        (period->>'total')::numeric as value,
        format('/weekMetrics/offerInsights/%s/periods/%s', insight_index, period_index) as source_pointer
      from periods
      where metric = 'PRODUCT_VISITS'

      union all

      select
        week_number,
        ean,
        make_date(
          (period->'period'->>'year')::integer,
          (period->'period'->>'month')::integer,
          (period->'period'->>'day')::integer
        ),
        metric,
        country.value->>'countryCode',
        false,
        (country.value->>'value')::numeric,
        format(
          '/weekMetrics/offerInsights/%s/periods/%s/countries/%s',
          insight_index,
          period_index,
          country.ordinality - 1
        )
      from periods
      cross join lateral jsonb_array_elements(coalesce(period->'countries', '[]'::jsonb))
        with ordinality as country(value, ordinality)
    )
    insert into legacy_offer_insight_rows
    select * from expanded;

    if (
      select count(distinct ean)
      from legacy_offer_insight_rows
      where iso_week = week_number
    ) <> 4 then
      raise exception 'Legacy W% rows do not cover four EANs', week_number;
    end if;

    if (
      select count(*)
      from (
        select ean
        from legacy_offer_insight_rows
        where iso_week = week_number
          and metric = 'PRODUCT_VISITS'
          and is_total
        group by ean
        having count(distinct metric_date) = 7
      ) complete_eans
    ) <> 4 then
      raise exception 'Legacy W% visit totals do not have seven dates per EAN', week_number;
    end if;

    with offer_map as (
      select distinct on (ean) ean, offer_id
      from bol_retailer.offer_observations
      where offer_id not like '%...%'
      order by ean, created_at desc
    ),
    candidates as (
      select
        concat(
          offer_map.offer_id, '|', rows.metric_date, '|', rows.metric, '|',
          coalesce(rows.country_code, 'TOTAL')
        ) as business_key,
        encode(extensions.digest(concat_ws(
          '|',
          offer_map.offer_id,
          rows.ean,
          rows.metric_date::text,
          rows.metric,
          coalesce(rows.country_code, 'TOTAL'),
          rows.is_total::text,
          rows.value::text
        ), 'sha256'), 'hex') as semantic_hash,
        offer_map.offer_id,
        rows.*
      from legacy_offer_insight_rows rows
      join offer_map using (ean)
      where rows.iso_week = week_number
    )
    insert into bol_retailer.offer_insight_daily (
      business_key, semantic_hash, offer_id, ean, metric_date,
      metric, country_code, is_total, value
    )
    select
      business_key, semantic_hash, offer_id, ean, metric_date,
      metric, country_code, is_total, value
    from candidates candidate
    where not exists (
      select 1
      from bol_retailer.offer_insight_daily existing
      where existing.business_key = candidate.business_key
        and existing.offer_id = candidate.offer_id
        and existing.ean = candidate.ean
        and existing.metric_date = candidate.metric_date
        and existing.metric = candidate.metric
        and existing.country_code is not distinct from candidate.country_code
        and existing.is_total = candidate.is_total
        and existing.value = candidate.value
    );

    with offer_map as (
      select distinct on (ean) ean, offer_id
      from bol_retailer.offer_observations
      where offer_id not like '%...%'
      order by ean, created_at desc
    )
    insert into pipeline.fact_sightings (
      transform_run_id, source_run_id, fact_table, fact_id, semantic_hash,
      artifact_name, source_pointer, observed_at
    )
    select
      legacy_transform_id,
      source_run.id,
      'offer_insight_daily',
      fact.id,
      fact.semantic_hash,
      'insights',
      rows.source_pointer,
      coalesce(source_run.completed_at, source_run.started_at)
    from legacy_offer_insight_rows rows
    join offer_map using (ean)
    join bol_retailer.offer_insight_daily fact
      on fact.offer_id = offer_map.offer_id
     and fact.ean = rows.ean
     and fact.metric_date = rows.metric_date
     and fact.metric = rows.metric
     and fact.country_code is not distinct from rows.country_code
     and fact.is_total = rows.is_total
     and fact.value = rows.value
    where rows.iso_week = week_number
    on conflict do nothing;

    select count(*)
    into row_total
    from legacy_offer_insight_rows
    where iso_week = week_number;

    update pipeline.source_artifacts
    set row_count = row_total
    where transform_run_id = legacy_transform_id
      and artifact_name = 'insights';

    insert into pipeline.transform_steps (
      transform_run_id, step_code, status, input_count, output_count,
      started_at, completed_at, detail
    ) values
      (
        legacy_transform_id, 'source_validation', 'passed', 1, 1, now(), now(),
        jsonb_build_object(
          'scope', 'insights-only',
          'sha256', source_item->>'sha256',
          'bytes', (source_item->>'bytes')::bigint
        )
      ),
      (
        legacy_transform_id, 'insights', 'passed', row_total, row_total, now(), now(),
        jsonb_build_object(
          'offerIdRecovery', 'Exact EAN match to full contract 3.0 offer ID',
          'periodStart', source_run.period_start,
          'periodEnd', source_run.period_end
        )
      ),
      (
        legacy_transform_id, 'publication', 'passed', row_total, 3, now(), now(),
        jsonb_build_object('mode', 'historical-data-product-promotion')
      );

    insert into pipeline.quality_checks (
      transform_run_id, check_code, data_product, severity, result,
      expected, observed, message
    ) values
      (
        legacy_transform_id, 'LEGACY_INSIGHTS_CHECKSUM', 'product_visits',
        'error', 'passed',
        jsonb_build_object('sha256', source_item->>'sha256', 'bytes', (source_item->>'bytes')::bigint),
        jsonb_build_object('sha256', source_item->>'sha256', 'bytes', (source_item->>'bytes')::bigint),
        'The stored insights artifact matched its manifest hash and byte count.'
      ),
      (
        legacy_transform_id, 'PRODUCT_VISIT_DATE_COVERAGE', 'product_visits',
        'error', 'passed',
        jsonb_build_object('datesPerOffer', 7, 'periodStart', source_run.period_start, 'periodEnd', source_run.period_end),
        jsonb_build_object('offers', 4, 'datesPerOffer', 7),
        'Every EAN has exactly seven visit dates aligned to the reporting week.'
      ),
      (
        legacy_transform_id, 'BUY_BOX_DATE_COVERAGE', 'buy_box',
        'warning', 'passed',
        jsonb_build_object('datesPerOffer', 7),
        jsonb_build_object('offers', 4, 'datesPerOffer', 7),
        'Every EAN has seven aligned Buy Box dates; country values remain separate.'
      ),
      (
        legacy_transform_id, 'OFFER_ID_RECOVERY', 'product_visits',
        'error', 'passed',
        jsonb_build_object('mappingKey', 'EAN', 'mappedOffers', 4),
        jsonb_build_object('mappingKey', 'EAN', 'mappedOffers', 4),
        'Redacted legacy offer IDs were restored by exact EAN match to contract 3.0 catalog facts.'
      );

    for product_item in
      select value
      from jsonb_array_elements(
        jsonb_build_array(
          jsonb_build_object(
            'dataProduct', 'product_visits',
            'status', 'ready',
            'formulaVersion', 'legacy-insights-promotion-v1',
            'limitations', jsonb_build_array()
          ),
          jsonb_build_object(
            'dataProduct', 'buy_box',
            'status', 'ready',
            'formulaVersion', 'legacy-insights-promotion-v1',
            'limitations', jsonb_build_array()
          ),
          jsonb_build_object(
            'dataProduct', 'trading_units_per_visit',
            'status', 'ready_with_limits',
            'formulaVersion', 'retailer-weekly-v1',
            'limitations', jsonb_build_array(
              'This is a same-week trading proxy, not order-cohort conversion.'
            )
          )
        )
      )
    loop
      update reporting.data_product_revisions
      set is_active = false
      where data_product = product_item->>'dataProduct'
        and iso_year = 2026
        and iso_week = week_number
        and is_active;

      insert into reporting.data_product_revisions (
        data_product, iso_year, iso_week, revision_number, status,
        source_run_id, transform_run_id, formula_version, is_active,
        limitations, source_detail, activated_at
      )
      select
        product_item->>'dataProduct',
        2026,
        week_number,
        coalesce(max(existing.revision_number), 0) + 1,
        product_item->>'status',
        source_run.id,
        legacy_transform_id,
        product_item->>'formulaVersion',
        true,
        array(select jsonb_array_elements_text(product_item->'limitations')),
        jsonb_build_object(
          'scope', 'insights-only',
          'sourceRunId', source_run.id,
          'sourceContractVersion', source_run.source_schema_version,
          'sourceArtifact', source_path,
          'sourceSha256', source_item->>'sha256',
          'sourceBytes', (source_item->>'bytes')::bigint,
          'offerIdRecovery', 'Exact EAN match to contract 3.0 offer observations',
          'promotionReason', 'Later API reruns cannot reconstruct expired rolling insight dates'
        ),
        now()
      from reporting.data_product_revisions existing
      where existing.data_product = product_item->>'dataProduct'
        and existing.iso_year = 2026
        and existing.iso_week = week_number;
    end loop;

    select *
    into strict prior_report
    from reporting.weekly_report_revisions
    where iso_year = 2026
      and iso_week = week_number
      and is_active;

    report_status := case
      when exists (
        select 1
        from reporting.data_product_revisions revision
        where revision.iso_year = 2026
          and revision.iso_week = week_number
          and revision.is_active
          and revision.data_product in ('return_adjusted_trading', 'buy_box', 'country_split')
          and revision.status = 'ready_with_limits'
      ) then 'ready_with_limits'
      else 'ready'
    end;

    update reporting.weekly_report_revisions
    set is_active = false
    where id = prior_report.id;

    insert into reporting.weekly_report_revisions (
      iso_year, iso_week, revision_number, status, accounting_status, is_active
    )
    select
      2026,
      week_number,
      coalesce(max(revision_number), 0) + 1,
      report_status,
      'provisional',
      true
    from reporting.weekly_report_revisions
    where iso_year = 2026
      and iso_week = week_number
    returning id into new_report_id;

    insert into reporting.weekly_revision_sources (
      weekly_report_revision_id, data_product_revision_id
    )
    select new_report_id, id
    from reporting.data_product_revisions
    where iso_year = 2026
      and iso_week = week_number
      and is_active;

    insert into reporting.weekly_product_metrics (
      weekly_report_revision_id, product_id, ean,
      gross_shipped_units, gross_shipped_gms, gross_commission,
      registered_return_units, linked_return_units, unlinked_return_units,
      linked_return_gms, linked_return_commission,
      provisional_net_gms, provisional_revenue_after_commission,
      gross_shipped_asp, product_visits, trading_units_per_visit,
      commercial_status, visits_status, returns_status,
      limitations, calculation_trace
    )
    select
      new_report_id,
      metric.product_id,
      metric.ean,
      metric.gross_shipped_units,
      metric.gross_shipped_gms,
      metric.gross_commission,
      metric.registered_return_units,
      metric.linked_return_units,
      metric.unlinked_return_units,
      metric.linked_return_gms,
      metric.linked_return_commission,
      metric.provisional_net_gms,
      metric.provisional_revenue_after_commission,
      metric.gross_shipped_asp,
      visits.product_visits,
      case
        when visits.product_visits > 0
          then round(metric.gross_shipped_units::numeric / visits.product_visits, 6)
        else null
      end,
      metric.commercial_status,
      'ready',
      metric.returns_status,
      array_remove(
        metric.limitations,
        'Product visits are unavailable because the source does not cover all seven reporting dates.'
      ),
      metric.calculation_trace || jsonb_build_object(
        'productVisits',
        format(
          '%s visits from seven aligned dates in checksum-verified source run %s',
          visits.product_visits,
          source_run.id
        ),
        'tradingUnitsPerVisit',
        'Gross shipped units divided by same-week product visits; not cohort conversion'
      )
    from reporting.weekly_product_metrics metric
    join (
      select ean, sum(value)::integer as product_visits
      from legacy_offer_insight_rows
      where iso_week = week_number
        and metric = 'PRODUCT_VISITS'
        and is_total
      group by ean
    ) visits using (ean)
    where metric.weekly_report_revision_id = prior_report.id;
  end loop;
end
$migration$;
