import type { ServiceModelType } from './types';

export const SERVICE_MODEL_UPDATED_EVENT = 'service-model-updated';

export interface ServiceModelUpdatedDetail {
  serviceType: ServiceModelType;
}

export function dispatchServiceModelUpdated(serviceType: ServiceModelType): void {
  window.dispatchEvent(
    new CustomEvent<ServiceModelUpdatedDetail>(SERVICE_MODEL_UPDATED_EVENT, {
      detail: { serviceType }
    })
  );
}
