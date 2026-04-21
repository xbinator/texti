import type { ModelServiceType } from 'types/model';

export const SERVICE_MODEL_UPDATED_EVENT = 'service-model-updated';

export interface ServiceModelUpdatedDetail {
  serviceType: ModelServiceType;
}

export function dispatchServiceModelUpdated(serviceType: ModelServiceType): void {
  window.dispatchEvent(
    new CustomEvent<ServiceModelUpdatedDetail>(SERVICE_MODEL_UPDATED_EVENT, {
      detail: { serviceType }
    })
  );
}
