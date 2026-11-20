import { useEffect, useState } from 'react';
import { createDeviceFirstTranslator } from './deviceFirst';

/** Stop background checks when the caller leaves this translation mode or page. */
export function useDeviceFirstTranslator(scope: string) {
  const [local] = useState(createDeviceFirstTranslator);
  useEffect(() => local.reset, [local, scope]);
  return local.translate;
}
